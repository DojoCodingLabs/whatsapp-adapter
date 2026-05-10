# mock-mode Specification

## Purpose
TBD - created by archiving change add-mock-mode. Update Purpose after archive.
## Requirements
### Requirement: MockWhatsAppClient mirrors the send surface of WhatsAppClient

The package SHALL export `MockWhatsAppClient` whose constructor accepts `{ phoneNumberId, wabaId, graphApiVersion?, windowTracker?, now?, templates? }`. The class SHALL expose the same public `send*` methods as `WhatsAppClient` (text, image, video, audio, document, sticker, location, contacts, interactive, template, reaction, reply) returning the same `MessageSendResponse` shape. Calls SHALL NOT issue any HTTP requests.

When `templates` is supplied, `listTemplates(query?)` SHALL filter the seed in memory by `query.name`, `query.language`, `query.status`, and `query.category` (string equality), apply `query.limit` if set, and return `{ data, paging?: { } }`. `getTemplate(templateId)` SHALL resolve with the matching seed entry or reject with `TemplateError(templateId)` when the id is not in the seed.

When `templates` is omitted (or empty), `listTemplates(query?)` SHALL return `{ data: [] }` and `getTemplate(templateId)` SHALL reject with `TemplateError(templateId)` carrying a "no template registry" message — preserving the v1 default behaviour.

#### Scenario: Default (no seed) — listTemplates returns empty

- **WHEN** `mock = new MockWhatsAppClient({ phoneNumberId: "P", wabaId: "W" })`
- **AND** `await mock.listTemplates()` is called
- **THEN** the result is `{ data: [] }`

#### Scenario: Default (no seed) — getTemplate rejects

- **WHEN** the same mock is used and `mock.getTemplate("T1")` is awaited
- **THEN** the call rejects with `TemplateError`
- **AND** the error's templateName / id mention is `"T1"`

#### Scenario: Seeded — getTemplate returns the matching definition

- **WHEN** `mock = new MockWhatsAppClient({ ..., templates: [{ id: "T1", name: "appt", language: "en_US", category: "UTILITY", status: "APPROVED", components: [] }] })`
- **AND** `await mock.getTemplate("T1")`
- **THEN** the result has `id === "T1"` and `name === "appt"`

#### Scenario: Seeded — getTemplate rejects on miss

- **WHEN** the same seeded mock is asked for a missing id
- **AND** `mock.getTemplate("missing")` is awaited
- **THEN** the call rejects with `TemplateError`

#### Scenario: Seeded — listTemplates filters by status

- **WHEN** the seed contains an APPROVED and a PENDING template
- **AND** `await mock.listTemplates({ status: "APPROVED" })`
- **THEN** the result's `data` contains only the APPROVED entry

#### Scenario: Seeded — listTemplates honours limit

- **WHEN** the seed contains 3 entries and `await mock.listTemplates({ limit: 2 })`
- **THEN** the result's `data` has length 2

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

