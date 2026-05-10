## Context

Phase 0 stubbed the `webhook-receiver` capability and Phase 3 lands the real surface. This is the most subtle part of the SDK: signature verification must operate on raw bytes (Express's `express.json()` re-serialises and that breaks HMAC); Meta retries failed deliveries with backoff for up to seven days, so the receiver must dedupe; the 200 ack must land within 30 s while handlers run async; and the parser has to make sense of Meta's nested `entry[].changes[]` envelope while staying tolerant of unknown `field` values that Meta adds without notice.

Domain rules from `openspec/config.yaml` `context` that this design must satisfy:
- HMAC over raw bytes; never over re-serialised JSON.
- Timing-safe compare via `crypto.timingSafeEqual`.
- 30 s ack guarantee — handlers cannot block the response.
- Dedupe by `wamid` since Meta retries for up to 7 days.
- Multi-tenant by construction — receiver instances do not share state.
- No `any`, typed errors, no swallowed exceptions.

## Goals / Non-Goals

**Goals:**
- A `WebhookReceiver` class consumers can drop into any HTTP framework.
- A `verifySignature` standalone util suitable for use *before* any framework parses the body.
- A polymorphic parser that turns Meta's envelope into a flat array of typed events.
- A `Storage` interface + `InMemoryStorage` for both dedupe (Phase 3) and the 24h-window tracker (Phase 4).
- Captured Meta payload fixtures and HMAC fuzz tests.

**Non-Goals:**
- Express/Fastify wiring — Phase 8.
- Auto-subscription (`POST /{waba-id}/subscribed_apps`) — out of scope.
- Reply-thread reconstruction beyond surfacing `context.id`.
- Interactive `flow` body parsing beyond surfacing as `unknown`.
- Handler retry semantics — consumers own that.

## Decisions

### Decision: `verifySignature` is a standalone export, NOT a method on `WebhookReceiver`
**Rationale.** Signature verification has to run **before** any framework parses the body. If it lived only as a method on the receiver, a consumer would have to instantiate the receiver before they could verify — which is fine but pushes the dep-injection boundary inward. As a standalone, it's importable from `@dojocoding/whatsapp` and runs in middleware that needs zero other state.
**Alternatives considered.** Method-only on the receiver (less ergonomic for middleware authors). Both export AND method (we already do — receiver wraps the standalone fn).

### Decision: `handlePayload` returns `{ status, dispatchPromise }` synchronously
**Rationale.** Meta requires an ack within 30 s but handlers can take longer (DB writes, downstream API calls). Returning synchronously with the status lets the consumer `res.status(status).end()` immediately, then optionally `await dispatchPromise` for testing. The framework adapter (Phase 8) acks first, then runs handlers in the background.
**Alternatives considered.** Return a Promise that resolves *after* handlers (defeats the 30-s rule unless handlers are fast — risky). Provide an explicit `ackDeadline` callback (more API surface, same outcome).

### Decision: `Storage` interface owns dedupe AND the 24-h window in Phase 4
**Rationale.** Both subsystems need a key-value store with TTL and bounded memory. Defining one interface here means Phase 4 reuses it; consumers BYO Redis by implementing `Storage`. The interface stays minimal: `get`, `set(key, value, ttlMs)`, `delete`. No streaming, no scan, no atomic ops needed.
**Alternatives considered.** Per-feature stores (more interface noise, no real benefit). Phase 4 defines its own (Phase 3 needs dedupe today; deferring means duplicating work).

### Decision: Lazy TTL eviction in `InMemoryStorage`
**Rationale.** A `setInterval` for cleanup leaks a timer reference and prevents `process.exit()` from being clean. Lazy eviction (check `expiresAt` on `get`) keeps the implementation timer-free; the trade-off is that ghost entries sit in the map until accessed. For Phase 3's dedupe with 1-hour TTL, the worst case is bounded by inbound rate × 1 hour. Acceptable.
**Alternatives considered.** Background sweep with `setInterval`/`setImmediate` (timer leak). LRU cap (extra complexity; not needed at our throughput).

### Decision: dedupe key is `${kind}:${wamid|id}:${maybeStatus}` not just `wamid`
**Rationale.** Status updates retry too. The same `wamid` will appear once per status transition (sent → delivered → read → failed). Keying purely on `wamid` would collapse all transitions to "seen once". Including the kind and status keeps each transition unique.
**Alternatives considered.** wamid-only (drops legitimate status updates). Two separate dedupers (more state).

### Decision: parser surfaces unknown fields as `{ kind: "unknown" }` rather than throwing
**Rationale.** Meta adds new webhook `field`s without breaking changes (e.g., `smb_app_state_sync`, `partner_solutions`). Throwing on unknown would force every consumer to upgrade the SDK in lockstep with Meta. Surfacing unknowns lets consumers log them and lets the SDK ship the new typed kind in a follow-up MODIFIED delta.
**Alternatives considered.** Throw (forces SDK version coupling). Silently drop (loses observability).

```
            ┌────────────────────────┐
            │  raw HTTP POST body    │
            └──────────┬─────────────┘
                       │
              ┌────────▼─────────┐
              │ verifySignature  │   timing-safe HMAC over raw bytes
              └────────┬─────────┘
                       │ ok
              ┌────────▼─────────┐
              │ parseWebhookPayload │  envelope → flat ReadonlyArray<event>
              └────────┬─────────┘
                       │
              ┌────────▼─────────┐
              │  WebhookDeduper  │   markIfNew per (kind:id:status)
              └────────┬─────────┘
                       │ new
              ┌────────▼─────────┐
              │  WebhookReceiver │   .on() registry; dispatchPromise
              │       .dispatch() │  resolves AFTER handlers run
              └──────────────────┘
                       │
                       └─ ack 200 returned synchronously to consumer
```

## Risks / Trade-offs

- **Risk:** A consumer awaits `dispatchPromise` synchronously inside the HTTP handler and breaks the 30-s ack. **Mitigation:** docs are explicit; the Phase 8 Express adapter never awaits.
- **Risk:** `Map`-backed `InMemoryStorage` grows unbounded if dedupe TTL is too long. **Mitigation:** lazy eviction; documented bound = inbound-rate × TTL.
- **Risk:** Meta evolves the envelope (e.g., adds a new `entry`-shape) and the parser silently misses it. **Mitigation:** unknown-field events surface as `{ kind: "unknown" }` so consumers see them in logs.
- **Trade-off:** Storage is async even for the in-memory case. Cost: a few microseconds of microtask. Benefit: same interface for Redis/Postgres consumers.
- **Trade-off:** `verifySignature` accepts `Buffer | Uint8Array | string` — strings get utf8-encoded. Documented; consumers passing a string MUST be sure no normalisation has happened.

## Migration Plan

Not applicable; the previous Phase 0 stub had only constants + the error class. No existing API breaks.

## Open Questions

- Should `WebhookReceiver` expose a way to ad-hoc-dispatch a synthetic event (for replay / testing without a real signature)? **Tentative:** yes, expose `_dispatchEvents(events[])` as `@internal`; consumed by `mock-mode` (Phase 6).
- Should the dedupe TTL be tied to `WINDOW_TTL_MS` from constants or a separate constant? **Decision:** separate constant `WEBHOOK_DEDUPE_TTL_MS = 60 * 60 * 1000`; behaviour is unrelated to the 24h window.
