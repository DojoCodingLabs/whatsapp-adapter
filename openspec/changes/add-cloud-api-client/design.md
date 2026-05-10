## Context

`WhatsAppClient` from Phase 0 only validates credentials. Every later phase that wants to talk to Meta — message sends (Phase 2), template ops (Phase 5), webhook subscription management (a future change) — needs the same four primitives: an authenticated request, a retry policy, an error mapper, and idempotency. Bundling them in this slice means Phase 2's `sendText` is a one-liner over `request()` rather than re-deriving retry semantics each time.

Domain rules from `openspec/config.yaml` `context` that this design must satisfy:
- Pinned Graph API version, constructor-overridable.
- No global state; multi-tenant by construction (so retry/jitter/idempotency are per-call, not per-process).
- Typed errors only; no `any` in error payloads.
- Never silently catch and swallow.
- Each commit must leave the tree typecheck/lint/test-clean.

## Goals / Non-Goals

**Goals:**
- One `request<T>()` method that the rest of the SDK calls.
- A retry policy that knows about Meta's rate-limit codes (130429/131048/131056/131053) AND HTTP transient codes (408/429/5xx).
- A pure `mapMetaError(httpStatus, body)` function — easily unit-tested with no fakes.
- `crypto.randomUUID()`-based idempotency key, attached as `X-Dojo-Idempotency-Key` and stable across retries.
- A `healthCheck()` method that calls `GET /debug_token` and returns a typed `TokenInfo`.
- Contract tests via `msw` — no real network, deterministic fixtures.

**Non-Goals:**
- Not adding message-builders here; `request()` is type-erased and Phase 2 owns body shapes.
- Not enforcing the 24h customer-service window on send; Phase 4 owns pre-flight enforcement. Phase 1 only maps Meta's `131026` response into `WindowClosedError`.
- No automatic token refresh, no global rate limiter, no media uploads, no streaming, no multipart, no per-WABA throughput governor.

## Decisions

### Decision: native `fetch` (Node 20+ global), not `undici` directly
**Rationale.** Node 20 ships `fetch` from the `undici` HTTP/1.1 client; using the global keeps the runtime-dep footprint at zero and means the SDK consumes whatever Node version the host runs (forward-compatible). For testing, `msw@^2`'s Node setup intercepts the global `fetch`, so contract tests work without a transport adapter.
**Alternatives considered.** Direct `undici` import (slightly faster, but adds a runtime dep and locks us out of Bun/Deno). `node-fetch` (legacy; Node 18+ ships `fetch`).

### Decision: full-jitter exponential backoff
**Rationale.** AWS Architecture Blog's "exponential backoff and jitter" piece established that "full jitter" — a uniformly random wait in `[0, capped backoff]` — collapses thundering-herd retries better than equal jitter or decorrelated jitter for our request volume. Math: `delay = random(0, min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)))`. With `baseDelayMs=250` and `maxAttempts=4`, worst-case wait is ~3.5 s before failing — well under Meta's webhook 30 s ack window.
**Alternatives considered.** Equal jitter (less spread). Decorrelated jitter (better mathematical bound; harder to reason about — and we have far fewer concurrent calls than the SQS workloads that motivated decorrelated jitter).

### Decision: `mapMetaError` is pure, retry decision lives in the retry helper
**Rationale.** The mapper takes (status, body) and returns a typed error. The retry helper takes a thrown error and decides "retryable?". Separating them keeps each piece small and testable. A `WhatsAppError` carrying a `metaCode` exposes enough information for the retry helper to reach a decision without re-parsing the response.
**Alternatives considered.** A single combined "fetch + map + retry" mega-function — harder to test, mixes IO and decision logic.

### Decision: idempotency key as a CUSTOM header (`X-Dojo-Idempotency-Key`)
**Rationale.** Meta's Graph API does not offer an idempotency-key contract on `/messages`. Even so, attaching our own UUID gives mock-mode and our own logs a way to correlate retries. Using a `X-Dojo-` prefix avoids stomping on a future Meta-defined header. The header is stable across all retries of the same logical request — generated once at the entry to `request()` and threaded through.
**Alternatives considered.** Skip it (loses retry correlation in logs). Use Meta's `messaging_product` request id (only present on responses; not echoed on requests). Send a hash of the body (less stable across requests with timestamps).

### Decision: `healthCheck()` calls `/debug_token` directly, not `/me`
**Rationale.** `/debug_token?input_token=…` returns expiry, app id, user id, AND scopes — far more diagnostic information than `/me`, and explicitly answers "is this token still good?". `/me` would return data even if the token is about to expire.
**Alternatives considered.** `/me` (less informative). A custom `whatsapp_business_account` lookup (returns 200 even on near-expired tokens until the request actually fails).

### Decision: retryable Meta codes hardcoded, NOT configurable
**Rationale.** The set is small (130429, 131048, 131056, 131053) and grounded in Meta's documented error codes. Letting consumers override risks them retrying on `131026` (window closed) and burning quota. If a future code needs adding, it's a one-line MODIFIED delta.
**Alternatives considered.** Config-driven retryable-codes (over-flexible, footgun).

```
                  ┌────────────────────────────────────────┐
                  │             request<T>()               │
                  └────────────────────┬───────────────────┘
                                       │ (uuid generated once)
                                       ▼
                       ┌──────────────────────────────────┐
                       │              retry()             │
                       │  exp-backoff + full-jitter loop  │
                       └─────────────┬────────────────────┘
                                     │ (per attempt)
                                     ▼
                              ┌──────────────┐
                              │   fetch()    │
                              └──────┬───────┘
                                     │
                       ┌─────────────┴─────────────┐
                       ▼                           ▼
                ┌──────────────┐           ┌─────────────┐
                │   2xx → T    │           │  non-2xx →  │
                │              │           │ mapMetaError│
                └──────────────┘           └──────┬──────┘
                                                  │
                                          retryable?  → loop
                                          else → throw typed
```

## Risks / Trade-offs

- **Risk:** `Retry-After: <HTTP-date>` parsing has historically had bugs (timezone, Date.parse quirks). **Mitigation:** unit-test the parser with several documented date formats; cap to `maxDelayMs` so a malformed value never causes minutes-long waits.
- **Risk:** Full-jitter random can occasionally produce a 0 ms backoff, hammering the server. **Mitigation:** floor delays at 50 ms when an error has been seen.
- **Risk:** `mapMetaError` may receive HTML or plain-text bodies (cloud-front interstitials, gateway timeouts) and crash. **Mitigation:** body-shape check before destructuring; fall back to `WhatsAppError("UNKNOWN")`.
- **Risk:** `crypto.randomUUID()` is part of Web Crypto and is in Node 20 globally — but TypeScript `lib: ["ES2022"]` may not type it on the global. **Mitigation:** import from `node:crypto` for typing safety.
- **Trade-off:** No per-WABA outbound rate limiter in this phase. Accepted; the 1-msg-per-6s pair limit (R5) is enforced by Meta's `131056`, and we retry on it. A proactive client-side limiter is its own future change.
- **Trade-off:** No automatic token refresh. `healthCheck()` reports expiry; the consumer either rotates tokens via Embedded Signup or fails closed.

## Migration Plan

Not applicable — Phase 1 only adds new methods; no existing callers depend on them yet.

## Open Questions

- Should `request()` accept an `AbortSignal` from the caller? **Tentative:** yes, threaded through to `fetch`'s `signal` option. Adds one optional field to the options object; no spec impact.
- Should `healthCheck()` cache its result for a TTL? **Tentative:** no in v1 — every caller decides freshness. Cache, if needed, lives in the consumer.
