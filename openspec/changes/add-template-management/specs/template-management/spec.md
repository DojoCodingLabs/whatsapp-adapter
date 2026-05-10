## ADDED Requirements

### Requirement: TemplateDefinition type and read API
The package SHALL export a `TemplateDefinition` type modelling Meta's approved-template shape (`id`, `name`, `language`, `category`, `status`, `components: ReadonlyArray<TemplateComponentDefinition>`, `quality_score?`). It SHALL export `listTemplates(client, query?)` and `getTemplate(client, templateId)` against `/{wabaId}/message_templates` (list) and `/{messageTemplateId}` (single). The list query supports `name`, `language`, `status`, `category`, `limit`, `after`, `before`.

#### Scenario: listTemplates posts GET to /{wabaId}/message_templates
- **WHEN** `listTemplates(client, { name: "appointment", limit: 25 })` is called
- **THEN** the underlying HTTP call is `GET /{wabaId}/message_templates?name=appointment&limit=25`
- **AND** the resolved value matches `{ data: TemplateDefinition[] }`

#### Scenario: getTemplate posts GET to /{templateId}
- **WHEN** `getTemplate(client, "TPL_ID")` is called
- **THEN** the underlying HTTP call is `GET /TPL_ID`

#### Scenario: Convenience methods on WhatsAppClient
- **WHEN** `client.listTemplates(query?)` and `client.getTemplate(id)` are called
- **THEN** each delegates to the standalone helper with `this` as the first arg

### Requirement: countTemplatePlaceholders helper
The package SHALL export `countTemplatePlaceholders(text)` that returns the number of unique `{{N}}` placeholders in `text`. Placeholders SHALL be 1-INDEXED, strictly contiguous (no gaps), and SHALL NOT include `{{0}}`. Mismatches SHALL throw `TemplateError`.

#### Scenario: Single placeholder
- **WHEN** `countTemplatePlaceholders("Hi {{1}}, your order is ready")`
- **THEN** the return value is `1`

#### Scenario: Multiple unique contiguous placeholders
- **WHEN** `countTemplatePlaceholders("Hi {{1}}, your appointment is at {{2}} on {{3}}")`
- **THEN** the return value is `3`

#### Scenario: Repeated placeholders count as one
- **WHEN** `countTemplatePlaceholders("Hi {{1}}, see you {{1}}!")`
- **THEN** the return value is `1`

#### Scenario: Gap in indexing throws
- **WHEN** `countTemplatePlaceholders("Hi {{1}} — {{3}}")`
- **THEN** the call throws `TemplateError`
- **AND** the error message names the missing index 2

#### Scenario: `{{0}}` throws
- **WHEN** `countTemplatePlaceholders("Hi {{0}}")`
- **THEN** the call throws `TemplateError`

#### Scenario: No placeholders returns 0
- **WHEN** `countTemplatePlaceholders("Hello world")`
- **THEN** the return value is `0`

### Requirement: validateTemplateSend cross-validator
The package SHALL export `validateTemplateSend(payload, definition)`. Given a built `TemplateMessage` payload and the approved `TemplateDefinition`, the helper SHALL:
1. Assert `payload.template.name === definition.name`.
2. Assert `payload.template.language.code === definition.language`.
3. For each component in `payload.template.components ?? []`, find the matching `definition.components[i]` by `type` (and, for buttons, by `sub_type` + `index`); if absent, throw `TemplateError`.
4. Compute the placeholder count for the matching definition component (header / body text via `countTemplatePlaceholders`; button URL or copy-code via the count of `{{N}}` placeholders in their `example.url`-equivalent). Assert `payload.template.components[i].parameters?.length === expected`.
Mismatches throw `TemplateError(message, definition.name)`.

#### Scenario: Matching name, language, and parameter counts pass
- **WHEN** the payload has `template.name === "appt_reminder"`, `language.code === "en_US"`, and `components: [{ type: "body", parameters: [{type: "text", text: "Dani"}, {type: "text", text: "10am"}] }]`, and the definition's body text is `"Hi {{1}}, your appointment is at {{2}}"`
- **THEN** `validateTemplateSend` returns without throwing

#### Scenario: Wrong template name throws
- **WHEN** the payload's `template.name` does not equal `definition.name`
- **THEN** the call throws `TemplateError`

#### Scenario: Wrong language code throws
- **WHEN** `payload.template.language.code === "es_ES"` and `definition.language === "en_US"`
- **THEN** the call throws `TemplateError`

#### Scenario: Parameter count mismatch throws
- **WHEN** the body component supplies 1 parameter against a definition expecting 2 placeholders
- **THEN** the call throws `TemplateError`
- **AND** the message names the component type and the expected vs actual count

#### Scenario: Component absent in the definition throws
- **WHEN** the payload includes a `header` component but the definition has none
- **THEN** the call throws `TemplateError`

### Requirement: Optional pre-flight validation on sendTemplate
`BuildTemplateInput` SHALL accept an optional `validateAgainst?: TemplateDefinition`. When provided, `buildTemplate` SHALL run `validateTemplateSend` after building the payload and BEFORE returning. `client.sendTemplate(input)` SHALL pass `input.validateAgainst` through to `buildTemplate` so that `client.sendTemplate({ ..., validateAgainst })` rejects synchronously (no HTTP) on a mismatch.

#### Scenario: Pre-flight mismatch rejects without HTTP
- **WHEN** `client.sendTemplate({ to, name, language, components, validateAgainst })` is called and the parameter count disagrees with `validateAgainst`
- **THEN** the returned promise rejects with `TemplateError`
- **AND** no outbound HTTP request is issued
