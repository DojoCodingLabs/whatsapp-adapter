## Context

Phase 1 gave us authenticated, retried Graph requests. To turn those into actual WhatsApp messages, callers need either to hand-craft Meta's wire JSON for every type (error-prone — variant fields, snake_case, 1-indexed `{{N}}`, optional `context` for replies, `recipient_type: "individual"`, the `messaging_product: "whatsapp"` everywhere) or rely on a typed builder layer. This change adds the builder layer.

Domain rules from `openspec/config.yaml` `context` that must be satisfied:
- 1-INDEXED template variables (off-by-one bug magnet).
- Errors are typed classes — invalid input rejects with `WhatsAppError`/`TemplateError`, never strings or untyped.
- No `any` in production code; discriminated unions for safety.
- Validation happens BEFORE outbound HTTP, never after.

## Goals / Non-Goals

**Goals:**
- A discriminated `WhatsAppMessage` union mirroring Meta's payload taxonomy.
- A zod schema per variant for runtime input validation.
- A pure builder per variant returning the validated wire object.
- A `sendMessage(client, payload)` helper and 12 convenience methods on `WhatsAppClient`.
- Reply variant via a top-level `context.message_id` (set on every builder when `replyTo` is provided).
- Fixture-based golden-JSON tests + fast-check property tests.

**Non-Goals:**
- `interactive.flow` body shape — out of scope for v1; rejected by the validator with a clear "not implemented" error.
- Template management (list/get) — Phase 5.
- Pre-flight 24h-window enforcement — Phase 4.
- Media uploads via `POST /{phoneNumberId}/media` — out of scope; `link` is supported, `id` is accepted but the consumer is expected to have obtained it externally.
- Automatic batching/queuing.

## Decisions

### Decision: zod for runtime validation, not Valibot or io-ts
**Rationale.** zod is the de-facto choice in the Node TypeScript ecosystem (most agents and consumers in this org already pull zod), supports discriminated unions natively (`z.discriminatedUnion("type", […])`), and lets us re-export schemas so consumers can reuse them for their own input parsing. Valibot is leaner but not yet ubiquitous; io-ts is more academic and heavier on adoption cost.
**Alternatives considered.** Hand-rolled type guards (less reusable; consumers would re-derive). Valibot (smaller bundle but consumer adoption tax). Yup (loose typing).

### Decision: builders return PLAIN objects; no class instances
**Rationale.** The wire payload is just JSON — wrapping it in a class would force every consumer that wants to inspect or mutate the object to call `.toJSON()` or similar. Builders return the structurally-typed object directly, which `JSON.stringify` serializes correctly.
**Alternatives considered.** Class-based builders with a `.toJSON()` method (more boilerplate, no real upside).

### Decision: convenience-method input shape uses `to` plus variant-specific fields, not a single nested object
**Rationale.** Ergonomics: `client.sendText({ to, body })` reads better than `client.sendText({ to, message: { body } })`. The cost is per-method input types, but those are mechanical to write and zod schemas validate them.
**Alternatives considered.** A single `client.send(payload)` method (less ergonomic; consumers always have to know the wire shape). Per-type subclient (`client.text.send(...)`) — feels OO-heavy for a plain SDK.

### Decision: `sendInteractive` accepts a `kind: "button" | "list" | "cta_url"` discriminator
**Rationale.** A single method instead of three separate ones keeps the public surface smaller. The discriminator type-narrows the rest of the input — a `kind: "button"` requires `buttons`, `kind: "list"` requires `sections`, etc.
**Alternatives considered.** Three separate methods (`sendInteractiveButton`, …) — more public-surface noise; we still expose the standalone builders for callers that want them.

### Decision: `sendReply` is a thin wrapper that takes a fully-built `WhatsAppMessage` and a `replyTo` wamid
**Rationale.** Replies are just any other message with `context.message_id` attached. Rather than duplicating 12 methods (`sendTextReply`, `sendImageReply`, …), the convenience layer offers `sendReply(originalWamid, payload)` which sets `context.message_id` and dispatches to `sendMessage`. Each builder ALSO supports `replyTo` directly for one-shot calls.
**Alternatives considered.** 12 dedicated reply methods (combinatorial explosion).

### Decision: `buildTemplate` validates parameter count BUT NOT name approval
**Rationale.** Phase 5 owns the name-approval check (because it requires querying Meta's `/message_templates` endpoint). Phase 2 stays offline-pure: it counts `parameters` arrays per component and matches against the caller-declared placeholder counts. Cross-template-name validation is layered on top in Phase 5.
**Alternatives considered.** Punt all template validation to Phase 5 (leaves Phase 2 unable to ship `buildTemplate` at all). Validate name approval in Phase 2 (forces a network call from a "pure" builder — bad layering).

### Decision: validation errors are `WhatsAppError("UNKNOWN", …)` with a `cause` of the zod issues; template-specific errors are `TemplateError`
**Rationale.** A typed-but-broad error keeps the public catch surface uniform (`catch (err) { if (err instanceof WhatsAppError) … }`); the underlying zod issues attach via `cause` for diagnostic detail. `TemplateError` is reserved for template-shape failures because they cross the line into Meta-side semantics (parameter count mismatch is a Meta-side rejection waiting to happen).
**Alternatives considered.** A new `ValidationError` subclass (would force Phase 0 to ship one; we'd rather not introduce more error classes for v1). Plain `Error` (loses the `WhatsAppError` discriminator).

```
                ┌──────────────────────────────────────┐
                │     client.sendText({to, body})      │
                └────────────────────┬─────────────────┘
                                     │
                              ┌──────▼──────┐
                              │ buildText() │  zod parse → throws on invalid
                              └──────┬──────┘
                                     │ wire payload
                              ┌──────▼──────────┐
                              │ sendMessage()   │  client.request("POST", path, payload)
                              └──────┬──────────┘
                                     │
                              ┌──────▼──────┐
                              │  Phase 1    │  retry, error mapping, idempotency
                              │  transport  │
                              └─────────────┘
```

## Risks / Trade-offs

- **Risk:** `interactive.list` Meta limits (100 chars per row title, 72 chars per section title, etc.) drift over time. **Mitigation:** schema constants colocated with the builder, easy to bump in a MODIFIED delta.
- **Risk:** `buildTemplate` parameter validation is approximate without the actual approved template definition (Phase 5 layers on the cross-validation). **Mitigation:** explicit Non-goal in this proposal; Phase 5 strengthens it.
- **Risk:** zod validation overhead per send. **Mitigation:** sub-millisecond per call in practice; we can cache parsed schemas. Not a concern at our throughput.
- **Trade-off:** Builders return plain objects, so a consumer can mutate the returned payload before sending. Documented as supported (it's just an object).
- **Trade-off:** `sendInteractive` with the `kind` discriminator means the type inference for unsupported variants (`flow`) appears as a TypeScript error, not a runtime one — except Meta's wire schema for `flow` is large; we explicitly reject `kind: "flow"` at runtime in v1.

## Migration Plan

Not applicable; net-new methods.

## Open Questions

- Should `sendContacts` accept a single `Contact` object as a shorthand (auto-wrap into an array)? **Tentative:** yes, the builder accepts `Contact | Contact[]`.
- Should we pre-emit `recipient_type: "individual"` on every message? **Decision:** yes; Meta accepts only "individual" in v23 and emitting it everywhere keeps the wire shape uniform.
