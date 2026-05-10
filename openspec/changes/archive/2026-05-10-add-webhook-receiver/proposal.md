## Why

The `webhook-receiver` capability stub from Phase 0 only owns constants and the error class. Real inbound message handling is the most subtle piece of the SDK: signature verification must run on raw bytes BEFORE any JSON parser sees them; the verify-token handshake must echo `hub.challenge`; Meta retries failed deliveries with backoff for up to seven days, so dedupe by `wamid` is mandatory; and the 200 ack must land within 30 s while handlers run async. This change extends `webhook-receiver` with the full receiver surface so consumers stop hand-rolling these traps.

## What Changes

- **NEW** `verifySignature({ rawBody, signatureHeader, appSecret }) → boolean` — timing-safe HMAC-SHA256 over raw body bytes. Tolerates the `sha256=` prefix and uppercase/lowercase hex.
- **NEW** `verifyHandshake({ mode, verifyToken, challenge, expectedToken }) → string | null` — returns `challenge` only when `mode === "subscribe"` AND `verifyToken === expectedToken`; otherwise `null`.
- **NEW** polymorphic event types under `src/webhooks/events.ts`: `MessageEvent` (text / image / video / audio / document / sticker / location / contacts / interactive / button / order / reaction / system / unknown), `StatusEvent` (sent / delivered / read / failed), `TemplateStatusEvent`, `TemplateQualityUpdateEvent`, `TemplateCategoryUpdateEvent`, `PhoneNumberQualityUpdateEvent`, `AccountAlertEvent`, `AccountReviewEvent`. Each carries the `phone_number_id`, `display_phone_number`, the originating `waba_id`, and a normalised `timestamp` (ms epoch).
- **NEW** `parseWebhookPayload(body) → ReadonlyArray<WhatsAppEvent>` — pure parser that walks Meta's `{ object: "whatsapp_business_account", entry: [{ id, changes: [{ field, value }] }] }` envelope and emits a flat array of typed events. Unknown fields surface as a `{ kind: "unknown", field, value }` event so handlers can opt in or log them.
- **NEW** `Storage` interface (introduced here, reused by Phase 4): `get(key)`, `set(key, value, ttlMs)`, `delete(key)`. Plus an `InMemoryStorage` that honours TTL and runs no background timers.
- **NEW** `WebhookDeduper` keyed on `wamid` for `messages` and on `id` for `statuses`. TTL defaults to `WINDOW_TTL_MS / 24 = 1 hour` (configurable; long enough to dedupe Meta retries within a normal incident, short enough that storage stays bounded).
- **NEW** framework-agnostic `WebhookReceiver` class:
  - constructor `{ appSecret, verifyToken, storage?, dedupeTtlMs?, onError? }`
  - `verify(rawBody, signatureHeader)` returning `boolean`
  - `handleVerifyRequest({ mode, verifyToken, challenge })` returning `{ status: 200, body: string } | { status: 403 }`
  - `handlePayload(rawBody, signatureHeader, payload)` — combines verify + parse + dedupe + dispatch; returns immediately so callers can ack 200 within 30 s while `dispatchPromise` resolves later.
  - `.on(eventKind, handler)` per kind (`message`, `status`, `template_status`, `template_quality`, `template_category`, `phone_number_quality`, `account_alert`, `account_review`, `unknown`, `error`).
- **NEW** captured Meta payload fixtures under `test/__fixtures__/webhooks/` and HMAC fuzz tests under `test/unit/webhooks/`.

## Capabilities

### Modified Capabilities
- `webhook-receiver`: extends the Phase 0 stub with the full inbound surface above. Phase 0's "typed error hierarchy" requirement is unchanged.

### New Capabilities
None — the `Storage` interface lives under `src/storage/` but is filed under the `webhook-receiver` capability for now; Phase 4's `window-tracker` consumes the same interface and does not redefine it.

## Non-goals

- **No Express/Fastify wiring**: Phase 8 owns framework adapters. Phase 3 ships the framework-agnostic primitives.
- **No client-side deduping window > 1 day**: Meta's 7-day retry envelope is documented but holding 7 days of `wamid`s in memory is impractical. Default TTL = 1 hour; configurable.
- **No reply-thread reconstruction**: incoming messages with `context.id` carry the `id` through to handlers but no graph is built.
- **No automatic webhook-subscription management**: configuring Meta's webhook URL via `/{waba-id}/subscribed_apps` is not in this change.
- **No interactive `flow` event handling beyond surfacing it as `unknown`**: Flows have a substantial inbound schema; Phase 3 does not interpret it.
- **No retry of consumer handlers**: a handler's thrown error fires the `error` event and is logged — but the SDK does not re-invoke. Consumers wanting at-least-once handler semantics own that.

## Impact

- **Code**: net-new `src/webhooks/{signature.ts,handshake.ts,events.ts,parser.ts,dedupe.ts,receiver.ts}`. New `src/storage/` directory with `Storage` interface and `InMemoryStorage`. `src/index.ts` re-exports the receiver surface.
- **APIs**: `WebhookReceiver`, `verifySignature`, `verifyHandshake`, `parseWebhookPayload`, all event types, `Storage`, `InMemoryStorage` become public.
- **Dependencies**: no new runtime deps (uses `node:crypto`). No new dev deps.
- **Systems**: tests stay vitest + msw. Captured webhook payload fixtures land under `test/__fixtures__/webhooks/`.
