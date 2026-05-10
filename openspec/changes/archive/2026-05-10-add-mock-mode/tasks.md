## 1. Shared interface

- [x] 1.1 Create `src/mock/types.ts` exporting `WhatsAppLikeClient` interface enumerating the public send surface (`phoneNumberId`, `wabaId`, `graphApiVersion`, the 12 send* methods, `isWindowOpen`, `listTemplates`, `getTemplate`).
- [x] 1.2 Add `RecordedSend` type ({ wamid, payload, sentAt }) and `MockWhatsAppClientOptions` type.

## 2. MockWhatsAppClient

- [x] 2.1 Create `src/mock/client.ts` exporting `MockWhatsAppClient`. Constructor `{ phoneNumberId, wabaId, graphApiVersion?, windowTracker? }`. No credentials required.
- [x] 2.2 Implement the 12 send* methods. Each builds via the existing builders (so input validation matches the real client), records into `#sentMessages`, and returns a deterministic `MessageSendResponse` with `wamid.mock-${counter}`.
- [x] 2.3 Honour `windowTracker` for free-form sends (text, media, location, contacts, interactive). Templates and reactions are window-exempt.
- [x] 2.4 `mock.sentMessages: ReadonlyArray<RecordedSend>` getter and `mock.reset()` method.
- [x] 2.5 Implement `listTemplates` / `getTemplate` returning empty / typed errors (the mock does not maintain a template registry in v1; real Meta templates require a separate fixture mechanism).

## 3. simulateInbound

- [x] 3.1 Add `mock.simulateInbound(receiver, event)` calling `receiver._dispatchEvents([event])`.
- [x] 3.2 Type-narrow event input via the same `WhatsAppEvent` discriminated union exported from the receiver capability.

## 4. Factory

- [x] 4.1 Create `src/mock/factory.ts` exporting `pickWhatsAppClient(options)`. Uses `process.env.WHATSAPP_MODE === "mock"` by default. Optional `forceReal` / `forceMock` overrides. Returns `WhatsAppLikeClient`.

## 5. Public surface

- [x] 5.1 `src/mock/index.ts` re-exports MockWhatsAppClient, WhatsAppLikeClient, RecordedSend, pickWhatsAppClient.
- [x] 5.2 `src/index.ts` re-exports the mock module.

## 6. Tests

- [x] 6.1 Add `test/unit/mock/client.test.ts`: sendText returns wamid.mock-1, sentMessages records the payload, no fetch is called, sequential wamids, reset() clears, sendTemplate is recorded, window gate honoured (closed → WindowClosedError), templates exempt from gate.
- [x] 6.2 Add `test/unit/mock/factory.test.ts`: WHATSAPP_MODE=mock picks the mock; default picks real; forceMock / forceReal overrides honoured.
- [x] 6.3 Add `test/parity/send-parity.test.ts`: parameterised matrix runs the same `sendText`, `sendImage`, `sendTemplate` etc. inputs against both real (msw-backed) and mock, asserts identical observable behaviour.
- [x] 6.4 Add `test/parity/inbound-parity.test.ts`: a synthetic message event fired via `mock.simulateInbound(receiver, event)` triggers handlers identically to a captured-fixture-driven `receiver.handlePayload(...)`.

## 7. Verification

- [x] 7.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [x] 7.2 `pnpm test:coverage` — gates honoured.
- [x] 7.3 `pnpm build` — `MockWhatsAppClient`, `pickWhatsAppClient`, `WhatsAppLikeClient`, `RecordedSend` all in `dist/index.d.ts`.
- [x] 7.4 `openspec validate add-mock-mode --strict` passes.
