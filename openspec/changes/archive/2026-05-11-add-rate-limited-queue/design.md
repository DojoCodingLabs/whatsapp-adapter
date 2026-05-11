## Context

Outbound sends today go straight from `client.send*` to the Graph
API. When a single process fans a notification job out to 10 K
recipients, that's 10 K simultaneous `POST /messages` calls — Meta
returns `131056` for the per-pair / per-WABA breach, the retry
loop kicks in with exponential backoff + `Retry-After`, and the
burst becomes a 30-second cascade of 429s. Throughput collapses
even though the recovery path is correct.

The fix is shape-based: insert a token bucket between the caller
and the HTTP call. The bucket models Meta's two simultaneous
ceilings (per-pair and per-WABA) and `await`s when no token is
available. Callers don't see this — they call `client.sendText({to,
body})` the same way, and the queue absorbs the wait.

Domain rules from `openspec/config.yaml` this design must satisfy:

- **Zero global state.** The queue is per-decorator-instance. Two
  `withRateLimit(...)` calls produce two independent queues, even
  on the same underlying client.
- **One library instance per WABA-phone pair.** Reinforced — the
  per-WABA bucket is keyed by the wrapped client's `wabaId`, so
  one decorator covers one phone; multi-WABA tenants instantiate
  multiple decorators.
- **OTel spans on every external API call.** The wrapped client's
  spans still fire; the queue adds `whatsapp.queue.acquire` so
  consumers can see queue latency separately from network latency.

## Goals / Non-Goals

**Goals:**

- `withRateLimit(client, options?)` returns a fresh
  `WhatsAppLikeClient`. Every `send*` method acquires a token from
  the per-pair AND per-WABA buckets before delegating to the
  wrapped client. `isWindowOpen`, `listTemplates`, `getTemplate`
  pass through unchanged (no queueing needed).
- Default ceilings: per-pair = 1 message per 6 s, per-WABA = 80
  MPS. Both configurable.
- `acquire()` waits via `setTimeout` until the next refill — no
  busy-wait, no spin.
- Per-pair buckets evict from the map after 60 s of full capacity
  to avoid unbounded growth for high-fan-out workloads.
- Pluggable `now: () => number` clock for deterministic tests.
- OTel `whatsapp.queue.acquire` span around the wait.

**Non-Goals:**

- Cross-process / distributed queueing.
- Persistence across process restart.
- Drain semantics, retry-after-drain, max-queue-depth backpressure.
- Cross-WABA buckets. One decorator = one WABA.

## Decisions

### Decision: decorator pattern, not a wrapped class

**Rationale.** The wrapped client is any `WhatsAppLikeClient`
— `WhatsAppClient`, `MockWhatsAppClient`, a future test fake.
Decorator preserves that polymorphism with one type and one set of
tests. A subclass-style wrapper would either need to extend each
concrete class (4× the surface) or take a generic and re-implement
every method anyway.

The decorator implements `WhatsAppLikeClient` by holding a
reference to the wrapped client and forwarding every method.
Non-send methods (`isWindowOpen`, `listTemplates`, `getTemplate`,
properties) forward without queueing.

### Decision: token bucket, not a leaky-bucket scheduler

**Rationale.** Token bucket allows short bursts up to capacity then
smooths to the steady-state rate. That matches Meta's actual
limits — they tolerate small bursts but throttle sustained breach.
A pure leaky bucket would forbid any burst, smoothing throughput
below Meta's actual ceiling.

```
capacity = N messages
refillRate = capacity / windowMs tokens/ms
```

`acquire(key)`:

1. `bucket = map.get(key) ?? new Bucket(...)`.
2. Refill based on elapsed time since last access.
3. If `bucket.tokens >= 1`, decrement and return immediately.
4. Otherwise compute `waitMs = (1 - bucket.tokens) / refillRate`
   and `setTimeout(waitMs)`, then retry from step 2.

### Decision: per-pair AND per-WABA, both must pass

**Rationale.** Meta enforces both simultaneously. Acquiring only
one would let the other slip. Implementation: `await
perPair.acquire(pairKey)` then `await perWaba.acquire(wabaKey)`.
Order doesn't matter for correctness; per-pair first is slightly
better because pair collisions are typically rarer than WABA
ceiling hits.

**Alternative:** a single bucket per `(pair, waba)` tuple — wrong;
the per-WABA ceiling is shared across ALL pairs.

### Decision: API shape

```ts
import { withRateLimit } from "@dojocoding/whatsapp";

const client = new WhatsAppClient({ ... });
const queued = withRateLimit(client, {
  perPair: { messages: 1, per: 6_000 },
  perWaba: { mps: 80 },
});

await queued.sendText({ to, body }); // identical surface, queued
```

`RateLimitOptions`:

```ts
export interface RateLimitOptions {
  perPair?: { messages: number; per: number }; // default { 1, 6000 }
  perWaba?: { mps: number }; // default { 80 }
  now?: () => number; // default Date.now
}
```

### Decision: extracting `to` from each `send*` method

**Rationale.** Each `Build*Input` shape has a top-level `to:
string`. The decorator can read `input.to` uniformly across
`sendText`, `sendImage`, …, `sendTemplate`, `sendReaction`. For
`sendReply(replyTo, payload, ...)`, the recipient is
`payload.to`.

### Decision: queueing is opt-in via the decorator, not the client

**Rationale.** Existing consumers don't get a behavioral change.
Single-tenant low-volume callers don't pay the bucket overhead.
Multi-tenant SaaS deployments wrap once per tenant.

**Alternative:** a `rateLimitOptions` field on
`WhatsAppClientOptions` — couples the queue to the client and
makes the mock harder to wire. The decorator wraps the mock too,
which is part of the appeal.

### Decision: eviction policy

**Rationale.** A long-running process that sends to thousands of
distinct phones over a day would accumulate thousands of `Bucket`
objects in the per-pair map. Eviction: a `Bucket` whose `tokens >=
capacity` for ≥ 60 s is removed on the next `acquire` sweep.
Constant-time per access; no background timer (which would
prevent process exit on Node).

## Control flow

```
caller: await queued.sendText({ to: "+52...", body: "hi" })
  │
  ▼
withSpan("whatsapp.queue.acquire") opens
  │
  ▼
perPair.acquire("PNID:+52...") — may wait up to 6 s
  │
  ▼
perWaba.acquire("WABA")        — may wait up to 1/80 s on a hot WABA
  │
  ▼
withSpan closes; span attribute: queue.waited_ms = ...
  │
  ▼
wrapped.sendText({ to, body }) — already-instrumented HTTP path
```

## Risks

- **Burst-at-startup:** a fresh bucket starts at capacity. A
  process that re-initializes per request would burst on every cold
  start. The decorator should be reused across requests
  (constructed once per service / per tenant).
- **Clock skew:** `Date.now` jumping forward or backward affects
  bucket refill math. Acceptable — Meta's ceilings tolerate
  millisecond noise. Document the `now` option for tests.
- **Mishandling concurrent `acquire` calls on an empty bucket:**
  the implementation must avoid two concurrent waiters both
  consuming the same refilled token. Solution: serialize per-bucket
  via a single-flight promise chain.

## Test layers

- **Unit**: `test/unit/queue/token-bucket.test.ts` — capacity,
  refill, fractional, two-key isolation, concurrent acquires,
  eviction.
- **Property**: `test/unit/queue/rate-adherence.test.ts` — N
  messages at M MPS take between `(N-1)/M` and `(N-1)/M + slack`
  seconds, for slack = 50 ms. Skipped under heavy CI load, retry
  once with larger slack.
- **Contract**: `test/contract/outbound-queue/with-rate-limit.test.ts`
  — wraps `MockWhatsAppClient`, asserts per-pair (1 / 6 s) and
  per-WABA (80 MPS) ceilings with an injected clock.

## Bundle expectations

- `dist/index.{cjs,js}` grows by ~3 KB (queue module + decorator).
- No new tsup entry. The queue lives at the root, exported as
  `withRateLimit`, `TokenBucket`, `type RateLimitOptions`.
