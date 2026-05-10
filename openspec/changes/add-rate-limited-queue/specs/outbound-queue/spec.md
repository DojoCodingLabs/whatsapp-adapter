## ADDED Requirements

### Requirement: TokenBucket primitive

The package SHALL export a `TokenBucket` class constructed with `{ capacity: number; refillPerMs: number; now?: () => number }`. It SHALL expose `acquire(count = 1): Promise<void>` that resolves immediately when sufficient tokens are available and otherwise waits via `setTimeout` until refill produces enough tokens. The bucket SHALL refill continuously at `refillPerMs` tokens per millisecond and clamp at `capacity`.

Concurrent `acquire` calls on an empty bucket SHALL be serialised via a single-flight promise chain. Two callers MUST NOT both consume the same refilled token.

#### Scenario: Fresh bucket starts at capacity

- **WHEN** `new TokenBucket({ capacity: 5, refillPerMs: 0.001 })` is constructed and `peek()` is called immediately
- **THEN** `peek()` returns `5`

#### Scenario: acquire(1) resolves immediately when tokens available

- **WHEN** a bucket has `peek() === 3` and `acquire(1)` is called
- **THEN** the returned Promise resolves within one event-loop tick
- **AND** `peek()` is `2` after resolution

#### Scenario: acquire(1) waits when bucket empty, resolves after refill

- **WHEN** a bucket has `peek() === 0`, `refillPerMs === 1 / 1000` (one token per second), and `acquire(1)` is called
- **THEN** the returned Promise resolves between 900 ms and 1100 ms later (using the real clock)
- **AND** `peek()` is `0` after resolution

#### Scenario: Concurrent acquire calls are serialised

- **WHEN** a bucket has `peek() === 0` and three `acquire(1)` calls are issued in the same tick
- **THEN** the three Promises resolve in order, each after the next token refills
- **AND** the order matches issue order

### Requirement: BucketMap primitive

The package SHALL provide a `BucketMap` that lazily creates `TokenBucket`s keyed by string. The map SHALL evict buckets whose tokens equal capacity AND whose last access was longer than `evictAfterMs` (default 60_000) ago. Eviction SHALL happen opportunistically during `acquire`; no background timer SHALL be scheduled.

#### Scenario: Distinct keys are isolated

- **WHEN** `acquire("A")` empties bucket A
- **THEN** `acquire("B")` resolves immediately because bucket B is independent

#### Scenario: Stale full buckets are evicted

- **WHEN** bucket A has been at full capacity for `evictAfterMs + 1` ms and any other `acquire` is called
- **THEN** the next `acquire("A")` starts a fresh bucket at full capacity (the old one was evicted)

### Requirement: withRateLimit decorator

The package SHALL export `withRateLimit(client, options?)` that returns a `WhatsAppLikeClient` whose `send*` methods are gated by two token buckets:

- A per-pair bucket keyed by `${client.phoneNumberId}:${to}` with default `{ messages: 1, per: 6_000 }`.
- A per-WABA bucket keyed by `client.wabaId` with default `{ mps: 80 }`.

The wrapper SHALL invoke `await perPair.acquire(pairKey)` then `await perWaba.acquire(wabaKey)` before delegating to the wrapped `client.send*`. All non-send methods (`isWindowOpen`, `listTemplates`, `getTemplate`) and readonly properties (`phoneNumberId`, `wabaId`, `graphApiVersion`) SHALL pass through without queueing. The wrapper SHALL extract the recipient from `input.to` for the standard `send*` methods and from `payload.to` for `sendReply(replyTo, payload, ...)`.

The wrapper SHALL emit a `whatsapp.queue.acquire` OTel span around the two `acquire` calls. Span attributes SHALL include `whatsapp.queue.waited_ms` (elapsed ms inside the span) and `whatsapp.queue.pair_key` (the PII-redacted `hashPhoneNumberId` digest of the recipient). The wrapped client's own `whatsapp.request` span SHALL fire AFTER the acquire span closes.

#### Scenario: Defaults applied when options omitted

- **WHEN** `withRateLimit(client)` is called with no options and the consumer sends two messages to the same recipient within 6 s
- **THEN** the second send's Promise resolves at least 6 s after the first send's Promise (per-pair ceiling enforced)

#### Scenario: Per-WABA ceiling

- **WHEN** the consumer sends 100 messages to 100 distinct recipients via a `withRateLimit(client, { perWaba: { mps: 80 } })` decorator
- **THEN** the elapsed time between the first send resolving and the 100th send resolving is at least `99 / 80` seconds (≈ 1.24 s) plus single-digit-ms scheduler slack

#### Scenario: Non-send methods pass through

- **WHEN** the consumer calls `isWindowOpen("+52...")`, `listTemplates()`, or `getTemplate("tpl_id")` via the decorator
- **THEN** the call delegates to the wrapped client immediately
- **AND** no `whatsapp.queue.acquire` span is emitted

#### Scenario: Recipient extracted from sendReply payload

- **WHEN** the consumer calls `decorated.sendReply(replyTo, payload)` with `payload.to === "+52..."`
- **THEN** the per-pair bucket key is `${client.phoneNumberId}:+52...` (using the payload's `to`, not `replyTo`)

#### Scenario: Two decorator instances are independent

- **WHEN** `withRateLimit(client)` is called twice
- **THEN** the two returned wrappers have independent buckets — sending through one does not consume tokens from the other

#### Scenario: Mock-backed wrapping for tests

- **WHEN** `withRateLimit` wraps a `MockWhatsAppClient` instead of a real client
- **THEN** the queue gates still apply, the mock's `recordedSends` reflects the queued order, AND no network call is made

### Requirement: Configurable clock for deterministic tests

`TokenBucket`, `BucketMap`, and `withRateLimit` SHALL accept an optional `now: () => number` clock. When omitted, they SHALL use `Date.now`. Tests SHALL be able to drive bucket math forward with a controlled clock; `setTimeout`-based waits inside `acquire` may still rely on the real `setTimeout`, but the bucket math itself SHALL be deterministic under the injected clock.

#### Scenario: Injected clock advances refill math

- **WHEN** a `TokenBucket` is constructed with a `now` callback that returns a controlled value, the consumer drains the bucket, advances the clock by 5_000 ms, then calls `peek()`
- **THEN** the returned token count equals `5_000 * refillPerMs` clamped at capacity
