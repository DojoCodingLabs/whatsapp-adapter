# mock-mode Specification

## Purpose
TBD - created by archiving change add-mock-mode. Update Purpose after archive.
## Requirements
### Requirement: MockWhatsAppClient mirrors the send surface of WhatsAppClient
The package SHALL export `MockWhatsAppClient` whose constructor accepts `{ phoneNumberId, wabaId, graphApiVersion?, windowTracker? }`. The class SHALL expose the same public `send*` methods as `WhatsAppClient` (text, image, video, audio, document, sticker, location, contacts, interactive, template, reaction, reply) returning the same `MessageSendResponse` shape. Calls SHALL NOT issue any HTTP requests.

#### Scenario: sendText records the payload in `sentMessages` and returns a deterministic wamid
- **WHEN** `await mock.sendText({ to: "X", body: "hi" })` is called
- **THEN** the resolved value is `{ messaging_product: "whatsapp", contacts: [{ input: "X", wa_id: "X" }], messages: [{ id: "wamid.mock-1" }] }`
- **AND** `mock.sentMessages` includes one entry whose `payload.text.body === "hi"` and `wamid === "wamid.mock-1"`
- **AND** `globalThis.fetch` is NOT called

#### Scenario: Sequential wamids increment per send
- **WHEN** `await mock.sendText(...)` is called twice
- **THEN** the wamids are `wamid.mock-1` and `wamid.mock-2` respectively

#### Scenario: Window gate is honoured when configured
- **WHEN** `mock` is constructed with a `windowTracker` for which `isWindowOpen("X")` returns false
- **AND** `mock.sendText({ to: "X", body: "hi" })` is called
- **THEN** the call rejects with `WindowClosedError`
- **AND** `mock.sentMessages` is unchanged

#### Scenario: Templates are window-exempt in the mock
- **WHEN** the closed-window state holds and `mock.sendTemplate({ to: "X", name: "t", language: "en_US" })` is called
- **THEN** the send succeeds and is recorded in `sentMessages`

### Requirement: simulateInbound dispatches synthetic events to a WebhookReceiver
`mock.simulateInbound(receiver, event)` SHALL call `receiver._dispatchEvents([event])` directly. The signature path is bypassed so consumers do not have to compute HMAC values for tests.

#### Scenario: simulateInbound triggers a registered handler
- **WHEN** a `WebhookReceiver` registers `.on("message", h)` and `mock.simulateInbound(receiver, syntheticMessageEvent)` is called
- **THEN** awaiting the returned promise resolves
- **AND** `h` is invoked exactly once with `syntheticMessageEvent`

### Requirement: reset() clears the sent log and wamid counter
`mock.reset()` SHALL set `mock.sentMessages` back to an empty array and reset the wamid counter so the next send produces `wamid.mock-1`.

#### Scenario: After reset, the next send is wamid.mock-1
- **WHEN** several sends have been made and `mock.reset()` is called
- **THEN** `mock.sentMessages.length === 0`
- **AND** the next `mock.sendText(...)` resolves with `messages: [{ id: "wamid.mock-1" }]`

### Requirement: pickWhatsAppClient factory honours WHATSAPP_MODE env
`pickWhatsAppClient(options)` SHALL return a `MockWhatsAppClient` when `process.env.WHATSAPP_MODE === "mock"`, and a `WhatsAppClient` otherwise. Optional `forceReal` / `forceMock` options SHALL override the env detection. The return type SHALL be `WhatsAppLikeClient` so consumer code can take the union.

#### Scenario: WHATSAPP_MODE=mock returns the mock
- **WHEN** `process.env.WHATSAPP_MODE === "mock"` and `pickWhatsAppClient({ phoneNumberId, wabaId, token, appSecret })` is called
- **THEN** the returned instance is a `MockWhatsAppClient`

#### Scenario: WHATSAPP_MODE unset returns the real client
- **WHEN** `process.env.WHATSAPP_MODE` is undefined or any other value
- **THEN** the returned instance is a `WhatsAppClient`

#### Scenario: forceMock overrides env
- **WHEN** the env says real but `forceMock: true` is passed
- **THEN** the returned instance is a `MockWhatsAppClient`

### Requirement: WhatsAppLikeClient shared interface
The package SHALL export a `WhatsAppLikeClient` interface listing the public send surface (`phoneNumberId`, `wabaId`, `graphApiVersion`, the 12 `send*` methods, `isWindowOpen`). Both `WhatsAppClient` and `MockWhatsAppClient` SHALL be assignable to this interface.

#### Scenario: A function taking WhatsAppLikeClient accepts both implementations
- **WHEN** a function declares `(client: WhatsAppLikeClient) => Promise<void>` and is passed first a `WhatsAppClient` and then a `MockWhatsAppClient`
- **THEN** the TypeScript compiler accepts both calls

