## Why

Internal tests, CI, and local development should not require real Meta credentials, real network, or a real ngrok tunnel. Today, contract tests rely on `msw` to mock the Graph API, which works for outbound — but inbound webhook flows (`receiver.handlePayload(...)`) need a way to inject synthetic events without computing HMAC signatures by hand. Phase 6 introduces the `mock-mode` capability: a `MockWhatsAppClient` with the same `send*` surface that records sent payloads in memory and a `simulateInbound` helper that pushes synthetic events into a `WebhookReceiver` without going through the signature path.

## What Changes

- **NEW** capability `mock-mode`.
- **NEW** `MockWhatsAppClient` class (`src/mock/client.ts`) sharing the same public send surface as `WhatsAppClient`:
  - `phoneNumberId`, `wabaId`, `graphApiVersion`, plus the same 12 `send*` methods (text, image, video, audio, document, sticker, location, contacts, interactive, template, reaction, reply).
  - Constructor accepts `{ phoneNumberId, wabaId, graphApiVersion?, windowTracker? }` — credentials are NOT required (no token, no appSecret).
  - Internally maintains a `sentMessages: ReadonlyArray<RecordedSend>` log accessible via `mock.sentMessages`.
  - Returns deterministic `MessageSendResponse` shapes with sequential wamids `wamid.mock-${counter}`.
  - Honours the `windowTracker` gate so parity tests around the 24h window work uniformly.
- **NEW** `RecordedSend` type: `{ wamid: string; payload: WhatsAppMessage; sentAt: number }`.
- **NEW** `mock.simulateInbound(receiver, event)` — pushes a synthetic `WhatsAppEvent` (or a partial helper input that the mock fills in defaults for) directly into `receiver._dispatchEvents([event])`. Bypasses signature verification.
- **NEW** `mock.reset()` — clears the sent log and the wamid counter.
- **NEW** factory `pickWhatsAppClient(options)` (`src/mock/factory.ts`): when `process.env.WHATSAPP_MODE === "mock"`, returns a `MockWhatsAppClient`; otherwise a real `WhatsAppClient`. Returns `WhatsAppLikeClient` (the shared interface). Consumers can pin behaviour explicitly with `forceReal` / `forceMock` options.
- **NEW** shared `WhatsAppLikeClient` interface so consumer code that only needs send capability can take the union.

## Capabilities

### New Capabilities
- `mock-mode`: in-memory client, simulateInbound, factory.

### Modified Capabilities
None — `WhatsAppClient` is unchanged. The shared `WhatsAppLikeClient` interface is purely additive.

## Non-goals

- **No HTTP server**: the mock does not stand up a local server to receive simulated webhooks. `simulateInbound` calls the receiver directly. Consumers wanting an end-to-end HTTP roundtrip can layer that on themselves.
- **No multi-tenant routing inside the mock**: one `MockWhatsAppClient` is one phone-number id.
- **No fault injection** (random failures, latency simulation, throttle behaviour). A future change can add a `MockBehavior` strategy if needed.
- **No automatic webhook payload generation**: `simulateInbound` accepts a typed `WhatsAppEvent`. The consumer constructs it (or imports a fixture).

## Impact

- **Code**: net-new `src/mock/{client.ts,factory.ts,types.ts,index.ts}`. No changes to existing source.
- **APIs**: `MockWhatsAppClient`, `RecordedSend`, `WhatsAppLikeClient`, `pickWhatsAppClient` become public. Existing callers untouched.
- **Dependencies**: none.
- **Systems**: parity tests under `test/parity/` parameterise the same scenarios across `WhatsAppClient` (msw-backed) and `MockWhatsAppClient`.
