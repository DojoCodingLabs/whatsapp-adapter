## 1. Token-bucket primitive

- [ ] 1.1 Create `src/queue/token-bucket.ts` exporting a `TokenBucket` class with constructor `{ capacity: number; refillPerMs: number; now?: () => number }`.
- [ ] 1.2 `acquire(count = 1): Promise<void>` resolves immediately when tokens are available; otherwise `setTimeout` until refill, then retry. Concurrent `acquire`s on an empty bucket must serialize via a single-flight promise chain so two callers don't both consume the same refilled token.
- [ ] 1.3 Method `peek(): number` returns the current token count (after refill); used by tests and by the eviction policy.
- [ ] 1.4 No background timers — eviction is opportunistic, done at the caller's discretion.

## 2. Multi-key bucket map

- [ ] 2.1 Create `src/queue/bucket-map.ts` exporting a `BucketMap` that owns a `Map<string, TokenBucket>`. `acquire(key, count = 1): Promise<void>` lazily creates buckets keyed by the input string.
- [ ] 2.2 Implement opportunistic eviction: on each `acquire`, sweep buckets whose tokens equal capacity AND whose last-touched timestamp is older than `evictAfterMs` (default 60 s). Constant amortised time per acquire.
- [ ] 2.3 Configurable `evictAfterMs` via the `BucketMap` constructor.

## 3. Decorator (`withRateLimit`)

- [ ] 3.1 Create `src/queue/with-rate-limit.ts` exporting `withRateLimit(client, options?)` that returns a fresh `WhatsAppLikeClient`.
- [ ] 3.2 Defaults: `perPair = { messages: 1, per: 6_000 }`, `perWaba = { mps: 80 }`, `now = Date.now`.
- [ ] 3.3 Internally construct two `BucketMap`s. Per-pair refill rate = `messages / per`. Per-WABA refill rate = `mps / 1000`.
- [ ] 3.4 Forward every `send*` method: extract `input.to` (or `payload.to` for `sendReply`), `await` per-pair acquire on `${client.phoneNumberId}:${to}`, `await` per-WABA acquire on `client.wabaId`, then delegate.
- [ ] 3.5 Pass-through methods: `isWindowOpen`, `listTemplates`, `getTemplate`, and the readonly properties `phoneNumberId`, `wabaId`, `graphApiVersion`. No queue overhead.
- [ ] 3.6 Wrap the acquire pair in `withSpan("whatsapp.queue.acquire", ...)` so consumers can see queue latency separately from network latency. Span attributes: `whatsapp.queue.pair_key` (PII-redacted via `hashPhoneNumberId`), `whatsapp.queue.waited_ms`.

## 4. Public API

- [ ] 4.1 Create `src/queue/index.ts` re-exporting `withRateLimit`, `TokenBucket`, `type RateLimitOptions`.
- [ ] 4.2 Add `export * from "./queue/index.js"` to `src/index.ts`.
- [ ] 4.3 No new tsup entry; the queue lives in the root bundle.

## 5. Tests

- [ ] 5.1 `test/unit/queue/token-bucket.test.ts`:
  - Fresh bucket starts at capacity.
  - `acquire(1)` succeeds immediately when tokens available.
  - `acquire(1)` waits when empty; resolves after refill.
  - Refill math: after `t` ms, tokens = min(capacity, previous + t \* refillPerMs).
  - Concurrent `acquire(1)` calls on an empty bucket are serialized; no double-consume.
- [ ] 5.2 `test/unit/queue/bucket-map.test.ts`:
  - Distinct keys are isolated.
  - Eviction sweeps stale full buckets after `evictAfterMs`.
  - Newly accessed key after eviction starts fresh at capacity.
- [ ] 5.3 `test/unit/queue/rate-adherence.test.ts` (property test):
  - For N sends at M MPS with a fake clock, elapsed time between first and last is in `[(N-1)/M ms, (N-1)/M + slack ms]`.
- [ ] 5.4 `test/contract/outbound-queue/with-rate-limit.test.ts`:
  - Wraps a `MockWhatsAppClient`. Defaults applied. Send to one recipient twice within 6 s — second call waits.
  - Per-WABA ceiling: send to 100 distinct recipients at the same time; throughput respects 80 MPS within 50 ms slack.
  - Non-send methods (`isWindowOpen`, `listTemplates`, `getTemplate`) pass through without queueing.
  - The decorator does NOT touch the wrapped client's internal state (only invokes its public methods).

## 6. Documentation

- [ ] 6.1 Add `docs/queue.md` covering API, defaults, when to use, when NOT to use (distributed deploys), OTel attributes.
- [ ] 6.2 Update `docs/patterns.md` § 6 (Rate-limit-aware queue): point at `withRateLimit` as the built-in primitive; preserve the by-hand pattern for consumers who need cross-process queueing.
- [ ] 6.3 Update `docs/architecture.md` capability table with the `outbound-queue` row.
- [ ] 6.4 Update `CHANGELOG.md` `[Unreleased]` with the new primitive and decorator.

## 7. Archive

- [ ] 7.1 `openspec validate --changes --strict` — clean.
- [ ] 7.2 Push, wait for CI green (release-discipline skill).
- [ ] 7.3 Tick checkboxes; commit.
- [ ] 7.4 `openspec archive add-rate-limited-queue --yes`.
- [ ] 7.5 Commit the archive + spec deltas.
