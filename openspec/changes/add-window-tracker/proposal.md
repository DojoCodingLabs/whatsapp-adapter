## Why

Meta enforces a 24-hour customer-service window: free-form messages can only be sent within 24 h of the customer's last inbound message; outside the window only approved templates may be sent. Today the SDK only learns about a closed window AFTER a send fails with Meta error `131026`. Pre-flight enforcement is cheaper, faster, and lets consumers branch ("send a follow-up template instead") without burning quota. This change introduces the new `window-tracker` capability with a `WindowTracker` class that consumers wire into both the inbound webhook receiver (to notify on inbound messages) and the outbound client (to gate free-form sends).

## What Changes

- **NEW** capability `window-tracker`.
- **NEW** `WindowTracker` class (`src/window/tracker.ts`):
  - Constructor `{ phoneNumberId, storage, ttlMs? }`. `ttlMs` defaults to `WINDOW_TTL_MS` (24 h).
  - `notifyInbound(customerWaId, atMs?)` records the last-inbound timestamp.
  - `isWindowOpen(customerWaId)` returns `true` iff the tracker has a fresh `notifyInbound` for this customer within `ttlMs`.
  - Storage key shape: `window:${phoneNumberId}:${customerWaId}`.
  - Tracker uses the `Storage` interface introduced by Phase 3 — consumers BYO Redis by implementing `Storage`.
- **NEW** optional `WhatsAppClientOptions.windowTracker?: WindowTracker`.
  - When set, the convenience send methods classified as "free-form" (`sendText`, `sendImage`, `sendVideo`, `sendAudio`, `sendDocument`, `sendSticker`, `sendLocation`, `sendContacts`, `sendInteractive`) check the tracker BEFORE issuing the request and throw `WindowClosedError(to)` if the window is closed.
  - `sendTemplate` and `sendReaction` are window-exempt and never gated.
  - `sendReply` checks the window for non-template payloads.
- **NEW** `src/window/index.ts` re-exports `WindowTracker`.
- **NEW** integration test fixture: a captured Meta payload + a tracker that observes the inbound and lets a follow-up free-form send through, then time-advances and confirms the next free-form send throws.

## Capabilities

### New Capabilities
- `window-tracker`: 24h customer-service-window state machine + pre-flight enforcement on outbound free-form sends.

### Modified Capabilities
- `cloud-api-client`: adds the optional `windowTracker` constructor field and the pre-flight-check behaviour on free-form sends.

## Non-goals

- **No automatic fallback to a re-engagement template**: when the window is closed, the SDK throws `WindowClosedError` and lets the consumer decide whether to send a template or drop the message. Auto-fallback hides intent and burns approved-template quota silently.
- **No persistence of inbound contents**, only of the timestamp.
- **No scan / list of open conversations**: the `Storage` interface stays minimal (get / set / setIfAbsent / delete). Consumers needing a list go to their database.
- **No Redis adapter shipped**: only `InMemoryStorage` from Phase 3. Consumers implement `Storage` for their backend.

## Impact

- **Code**: `src/window/tracker.ts` (net-new). `src/client/whatsapp-client.ts` adds the optional field and the pre-flight gate. `src/index.ts` re-exports `WindowTracker`.
- **APIs**: `WindowTracker` becomes public. `WhatsAppClientOptions.windowTracker` is additive; existing callers continue to work without changes.
- **Dependencies**: none.
- **Systems**: tests stay unit + msw-driven.
