## Context

Phases 0–5 give us a real client, a real receiver, and contract-test infrastructure that uses `msw` for outbound. What's missing is a way to test inbound flows without computing HMAC signatures by hand and without standing up an HTTP server. Phase 6 fills that gap with a parity-tested `MockWhatsAppClient` and a `simulateInbound` helper that pushes synthetic events into a `WebhookReceiver` directly.

Domain rules from `openspec/config.yaml` `context` that this design must satisfy:
- Mock mode (`WHATSAPP_MODE=mock`) MUST satisfy the same public interface as the real client.
- No `any`, typed errors only.
- Multi-tenant by construction — one mock per phone-number id.

## Goals / Non-Goals

**Goals:**
- A `MockWhatsAppClient` with the same `send*` surface as `WhatsAppClient`.
- An in-memory `sentMessages` log accessible from tests.
- Deterministic wamids (`wamid.mock-1`, `wamid.mock-2`, …).
- A `simulateInbound(receiver, event)` helper for dispatch-side testing.
- A `pickWhatsAppClient(options)` factory respecting `WHATSAPP_MODE`.
- A shared `WhatsAppLikeClient` interface for parity.

**Non-Goals:**
- Local HTTP server simulation. The mock dispatches in-process.
- Fault injection / latency simulation. Future change if needed.
- Recording inbound webhook bodies — only sent payloads are recorded.

## Decisions

### Decision: `MockWhatsAppClient` is a separate class, NOT a subclass of `WhatsAppClient`
**Rationale.** The real client requires credentials and ties into transport / retry / idempotency machinery the mock has no use for. Subclassing would either force the mock to fake credentials or break LSP. Separate classes assignable to a common `WhatsAppLikeClient` interface keeps each implementation honest.
**Alternatives considered.** Subclass + override (LSP issues). Mixin / composition pattern (more complex; same downside).

### Decision: deterministic wamids by counter, not random
**Rationale.** Tests asserting on specific wamids (`wamid.mock-1`) need stable values. A random UUID would force every test to capture-and-compare. Sequential counters reset by `mock.reset()` keep tests trivially predictable.
**Alternatives considered.** UUID (less predictable). Hash of payload (collisions, harder to debug).

### Decision: `simulateInbound` calls `receiver._dispatchEvents([event])` directly, bypassing signature
**Rationale.** Forcing consumers to compute HMAC for every fixture defeats the point of the mock. The receiver already exposes `_dispatchEvents` as `@internal` for exactly this purpose. The mock owns the call so the contract stays ergonomic.
**Alternatives considered.** Force consumers to compute signatures (high friction). Have the mock generate a signature against a known appSecret (still requires raw-body management; not the point of mock-mode).

### Decision: `pickWhatsAppClient` returns the union type
**Rationale.** The factory's job is to abstract the choice. Consumer code should take `WhatsAppLikeClient` so it can run uniformly against either backend. Returning a concrete class would force callers to type-narrow.
**Alternatives considered.** Two factories (`forReal`, `forMock`) — same effect but more API surface. A class hierarchy (cf. previous decision; rejected).

### Decision: the mock honours `windowTracker` exactly like the real client
**Rationale.** Parity tests need to exercise the same window-closed throw paths. Without the gate, the mock would silently succeed where the real client would throw — divergent semantics defeat parity.
**Alternatives considered.** Skip the gate (divergent). Always throw on free-form sends without a tracker (overshoots; real client only throws when configured).

```
                   pickWhatsAppClient(options)
                          │
            ┌─────────────┴─────────────┐
            │                           │
   process.env.WHATSAPP_MODE     forceReal | forceMock
            │                           │
   ┌────────┴────────┐                  │
  "mock"           else                 │
    ▼               ▼                   ▼
  MockWhatsAppClient   WhatsAppClient   chosen
            └────────────┬──────────────┘
                         ▼
                WhatsAppLikeClient (union)
```

## Risks / Trade-offs

- **Risk:** Real and mock clients drift apart over time as new send methods are added. **Mitigation:** the `WhatsAppLikeClient` interface is a single source of truth; CI typecheck catches a missing method on either side. Parity tests under `test/parity/` exercise the matrix.
- **Risk:** Tests that work against the mock pass false-positives because the mock doesn't validate everything Meta would. **Mitigation:** the mock runs the same `buildText` / builder validators (it just delegates) so input-validation parity holds. Wire-shape parity is the remaining gap; assertions on `sentMessages[i].payload` give consumers visibility into the would-be wire body.
- **Trade-off:** No fault injection in v1. Acceptable; a future `MockBehavior` strategy can layer it on without breaking the public surface.
- **Trade-off:** `simulateInbound` requires consumers to construct a synthetic `WhatsAppEvent`. We don't ship a fixture-builder helper in v1 to avoid prescribing one shape.

## Migration Plan

Additive — `WhatsAppClient` is unchanged. Consumers opt in to `MockWhatsAppClient` / `WhatsAppLikeClient` / `pickWhatsAppClient` as they need.

## Open Questions

- Should `MockWhatsAppClient` track `simulateInbound` history too (so tests can assert on dispatched events post-hoc)? **Tentative:** no — the receiver's handlers already get the event; tests can assert there.
