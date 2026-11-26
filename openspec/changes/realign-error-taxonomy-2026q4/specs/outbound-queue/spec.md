## MODIFIED Requirements

### Requirement: withRateLimit decorator

The package SHALL export `withRateLimit(client, options?)` that returns a `WhatsAppLikeClient` whose `send*` methods are gated by two token buckets:

- A per-pair bucket keyed by `${client.phoneNumberId}:${to}` with default `{ messages: 1, per: 6_000 }`.
- A per-business-phone-number throughput bucket keyed by `client.phoneNumberId`, configured by `perPhone: { mps }` with default `{ mps: 80 }` (Meta: "up to 80 mps by default per registered business phone number", inbound and outbound combined). `perWaba: { mps }` SHALL be accepted as a deprecated alias, used only when `perPhone` is absent.

The wrapper SHALL invoke `await perPair.acquire(pairKey)` then `await perPhone.acquire(phoneKey)` before delegating to the wrapped `client.send*`. All non-send methods (`isWindowOpen`, `listTemplates`, `getTemplate`) and readonly properties (`phoneNumberId`, `wabaId`, `graphApiVersion`) SHALL pass through without queueing. The wrapper SHALL extract the recipient from `input.to` for the standard `send*` methods and from `payload.to` for `sendReply(replyTo, payload, ...)`.

The wrapper SHALL emit a `whatsapp.queue.acquire` OTel span around the two `acquire` calls. Span attributes SHALL include `whatsapp.queue.waited_ms` (elapsed ms inside the span) `whatsapp.queue.pair_recipient` (the PII-redacted `hashPhoneNumberId` digest of the recipient), `whatsapp.queue.waba_id` and `whatsapp.queue.phone_number_id` (both `hashPhoneNumberId` digests; raw ids SHALL NOT appear). The wrapped client's own `whatsapp.request` span SHALL fire AFTER the acquire span closes.

#### Scenario: Defaults applied when options omitted

- **WHEN** `withRateLimit(client)` is called with no options and the consumer sends two messages to the same recipient within 6 s
- **THEN** the second send's Promise resolves at least 6 s after the first send's Promise (per-pair ceiling enforced)

#### Scenario: Per-WABA ceiling

- **WHEN** the consumer sends 100 messages to 100 distinct recipients via a `withRateLimit(client, { perPhone: { mps: 80 } })` decorator (scenario name kept; the bucket is per business phone number)
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

#### Scenario: Deprecated perWaba alias is honoured

- **WHEN** `withRateLimit(client, { perWaba: { mps: 10 } })` is used and 15 sends to distinct recipients are issued at once
- **THEN** the sends take at least ~400 ms (the 10 MPS ceiling applies)
- **AND** when both `perPhone` and `perWaba` are set, `perPhone` wins

#### Scenario: Two phone numbers on one WABA do not share a bucket

- **WHEN** two clients with different `phoneNumberId` but the same `wabaId` are each wrapped with `perPhone: { mps: 5 }` and each send 5 messages at once
- **THEN** neither decorator waits for the other's tokens
