## MODIFIED Requirements

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
