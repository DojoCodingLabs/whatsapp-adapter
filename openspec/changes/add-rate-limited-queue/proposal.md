## Why

Meta enforces two rate ceilings on outbound sends from a WhatsApp
Business phone number:

1. **Per recipient-pair** — at most 1 message per 6 seconds to a given
   `(phoneNumberId, to)` pair. Exceed it and Meta returns error code
   131056 (`RateLimitError`).
2. **Per WABA** — a configurable messages-per-second ceiling for the
   whole Business Account (default 80 MPS for a verified account; up
   to 1000 MPS for high-volume tiers).

Today the SDK retries `RateLimitError` automatically with exponential
backoff + `Retry-After` honouring. That recovers after the fact, but
doesn't *prevent* the burst that caused the 429 in the first place.
For workloads that fan out (notification pipelines, marketing template
sends, replay-after-incident jobs), a pre-flight queue is the
difference between "5 retries per send for 30 s" and "smooth 80 MPS
throughput".

This change adds a small, in-process rate-limited queue and a
`withRateLimit` decorator that wraps any `WhatsAppLikeClient` and
returns the same `WhatsAppLikeClient` shape. Callers don't see the
queue — their `await client.sendText({ to, body })` just waits at
the bucket before issuing the HTTP request. This matches the
"queue-as-decorator" choice (option A from the Track D scoping
discussion).

The retry loop and the queue are complementary: the queue prevents
the burst; the retry handles the rare 429 that slips through (e.g.
when Meta tightens the limit mid-flight or another process shares
the same phone number).

## What Changes

- **NEW** capability `outbound-queue`:
  - `withRateLimit(client, options?)` decorator that returns a
    `WhatsAppLikeClient` whose `send*` methods queue via a token
    bucket before delegating to the wrapped client.
  - A `TokenBucket` primitive (per-pair + per-WABA) with an
    `acquire(key, count = 1): Promise<void>` API and pluggable clock
    for testing.
- **NEW** `src/queue/` module: `token-bucket.ts`,
  `with-rate-limit.ts`, `index.ts`.
- **NEW** unit tests:
  - Token-bucket math: capacity, refill rate, fractional refill,
    multiple keys.
  - Property-based: sending N messages at MPS = M takes between
    `(N-1)/M` and `(N-1)/M + slack` seconds.
- **NEW** contract test:
  `test/contract/outbound-queue/with-rate-limit.test.ts` asserting
  the wrapped client respects per-pair (1 / 6 s) and per-WABA
  ceilings against a `MockWhatsAppClient`.
- **MODIFIED** `src/index.ts` to re-export the new primitives.
- **MODIFIED** `CHANGELOG.md` `[Unreleased]`.

## Capabilities

### New Capabilities

- `outbound-queue`: `withRateLimit` decorator + `TokenBucket`
  primitive. Default ceilings: 1 msg per 6 s per pair, 80 MPS per
  WABA. Both configurable.

### Modified Capabilities

None. Existing `WhatsAppLikeClient` users continue to work
unchanged — the queue is opt-in via the decorator.

## Non-goals

- **Distributed / cross-process queues.** Out of scope; this is an
  in-process queue, suitable for a single Node worker. Multi-worker
  deployments need a shared backend (Redis BullMQ, SQS, Postgres job
  queue) which lives one layer up. Documented as a follow-up.
- **Persistent queueing across restarts.** In-memory only. If the
  process dies with messages queued, they're lost. Document this.
- **Cross-channel queueing.** The queue knows about WhatsApp sends
  only.
- **Receive-side rate limiting.** Meta delivers webhooks at whatever
  rate it likes; the receiver dedupes and dispatches as fast as it
  can. Not in scope here.
- **Drain-aware send.** No public `waitForDrain()` method — callers
  who need it can `await Promise.all(sends)`. Could revisit if
  asked for.

## Impact

- Public API: pure addition. Existing code unchanged.
- Bundle size: ~3 KB CJS (token bucket math + decorator + the union
  of `WhatsAppLikeClient` method signatures). Bundled into the root
  entry; no new subpath.
- Runtime: when the bucket has tokens available, the send latency
  is unchanged (microsecond overhead from `acquire()`). When the
  bucket is empty, the call awaits a `setTimeout` until refill.
- Memory: O(active pairs) for the per-pair map. The map evicts
  entries whose bucket has been at full capacity for ≥ 1 minute
  to avoid unbounded growth.
