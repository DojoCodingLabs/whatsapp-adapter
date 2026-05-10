## Context

Phase 2 builds template payloads from caller-declared `parameters` arrays without knowing what the *approved* template expects. Mismatches surface only after Meta returns `132012`, and by then we've burned an HTTP round-trip plus a queued OTel span. Phase 5 lifts the read API for templates and introduces a pure cross-validator so consumers can fail closed before sending.

Domain rules from `openspec/config.yaml` `context` that this design must satisfy:
- `{{N}}` is 1-INDEXED. The placeholder counter must reject `{{0}}` and reject gaps.
- `waba_id` (templates) is distinct from `phone_number_id` (sends). The list/get API uses `waba_id`.
- No `any` in production code.

## Goals / Non-Goals

**Goals:**
- A `TemplateDefinition` type matching Meta's response shape.
- `listTemplates` / `getTemplate` standalone helpers + client convenience methods.
- `countTemplatePlaceholders(text)` — pure helper, validated with property tests.
- `validateTemplateSend(payload, definition)` — pure cross-validator.
- Threaded as an optional `validateAgainst` on `BuildTemplateInput` and `sendTemplate`.

**Non-Goals:**
- Programmatic template authoring (create/edit/delete).
- Auto-fetch of definitions inside `sendTemplate`.
- Locale fallback / translation.
- Bulk validation of inbound webhook bodies against templates (out of scope for receiver — receiver only surfaces template-status events).

## Decisions

### Decision: validation is opt-in via `validateAgainst`, never automatic
**Rationale.** Auto-fetching the definition on every send doubles the latency and adds a second point of failure. Callers that care about pre-flight validation should fetch + cache the definition themselves (or call `getTemplate` once at boot). The SDK exposes the building blocks but doesn't impose its caching strategy on consumers.
**Alternatives considered.** Auto-fetch (latency cost, hidden failure modes). Mandatory `validateAgainst` (forces every consumer to fetch even when they trust their input).

### Decision: placeholder counter rejects `{{0}}` and gaps
**Rationale.** Meta's docs are unambiguous: variables are 1-indexed and contiguous. Allowing `{{0}}` or `{{1}}` followed by `{{3}}` would make the counter accept payloads that Meta will reject anyway — pure pre-flight failure savings. The validator names the missing index in its error message so consumers know exactly what to fix.
**Alternatives considered.** Permissive counter (loses the savings). Stop-on-first-error (less informative messages).

### Decision: button-component validation matches by `(sub_type, index)` not just `type`
**Rationale.** Templates can have multiple button components (one per button position). Matching only by `type === "button"` would collapse them. The wire format includes `sub_type` (`quick_reply` / `url` / `copy_code`) and a string `index` matching the button's position; the validator pairs payload component[i] against definition component matching both.
**Alternatives considered.** Match buttons positionally (fragile if order differs). Match by `index` only (could miss `sub_type` discrepancies).

### Decision: list/get helpers return Meta's response shape directly (with `data`/`paging` envelope)
**Rationale.** Consumers need access to `paging.cursors.after` to page through long template lists; flattening to a bare array would lose that. The `TemplateDefinition` type is the array element; the helper's return type is `{ data: TemplateDefinition[]; paging?: ... }`.
**Alternatives considered.** Auto-paginating iterator (more API surface, more state). Flatten to array (loses paging).

### Decision: `validateTemplateSend` is a separate exported function, not a method
**Rationale.** Pure helper, no `client` dependency. Easy to unit-test, easy for consumers to call against cached definitions. The `validateAgainst` plumbing on `buildTemplate` / `sendTemplate` is a thin convenience wrapper.
**Alternatives considered.** Method on `WhatsAppClient` (forces `client` instantiation just to validate). Hidden inside `sendTemplate` only (loses the standalone use case).

```
                     ┌────────────────────────┐
                     │   client.getTemplate    │  GET /{templateId}
                     └────────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │ TemplateDefinition   │  cache this (consumer)
                       └──────────┬───────────┘
                                  │
                                  ▼
                ┌────────────────────────────────────┐
                │ client.sendTemplate({              │
                │   ..., validateAgainst: def        │  buildTemplate runs
                │ })                                 │  validateTemplateSend
                └─────────┬──────────────────────────┘  pre-HTTP
                          │
                ┌─────────▼──────────┐
                │ TemplateError on   │  no network call
                │ mismatch           │
                └────────────────────┘
```

## Risks / Trade-offs

- **Risk:** Meta evolves the `TemplateDefinition` shape (new component types, new sub_types). **Mitigation:** the type is documented as "best-effort" and unknown component types in the definition pass through validation harmlessly (they don't match anything in the payload, and unmatched payload components throw — the asymmetry is intentional).
- **Risk:** Placeholder counter false-positives on text that mentions `{{1}}` literally (e.g., a developer doc embedded in the body). **Mitigation:** Meta's component text is template-substituted server-side, so `{{1}}` literal text without an actual variable is itself a Meta-side authoring bug. We treat `{{N}}` as variables.
- **Trade-off:** No auto-paginating list helper. Callers manually use `paging.cursors.after`. Lower API surface in v1.
- **Trade-off:** `validateAgainst` adds a field to `BuildTemplateInput` that not every caller will use. Cost is one extra optional field; benefit is the consumer doesn't have to import `validateTemplateSend` separately.

## Migration Plan

Additive. `validateAgainst` is optional; existing `sendTemplate` callers keep working without changes.

## Open Questions

- Should `client.sendTemplate` cache the most-recently-fetched definitions in-process for an opt-in cache TTL? **Tentative:** no in v1 — caching is the consumer's call.
