## MODIFIED Requirements

### Requirement: countTemplatePlaceholders helper
The package SHALL export `countTemplatePlaceholders(text)` that returns the number of unique positional `{{N}}` placeholders in `text`. Placeholders SHALL be 1-INDEXED, strictly contiguous (no gaps), and SHALL NOT include `{{0}}`. A named placeholder (`{{customer_name}}`) SHALL throw `TemplateError` pointing the caller at `parameter_name` handling rather than being silently ignored. Mismatches SHALL throw `TemplateError`.

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

#### Scenario: Named placeholder throws
- **WHEN** `countTemplatePlaceholders("Hi {{customer_name}}")`
- **THEN** the call throws `TemplateError`
- **AND** the message mentions `parameter_name`

### Requirement: validateTemplateSend cross-validator
The package SHALL export `validateTemplateSend(payload, definition)`. Given a built `TemplateMessage` payload and the approved `TemplateDefinition`, the helper SHALL:
1. Assert `payload.template.name === definition.name`.
2. Assert `payload.template.language.code === definition.language`.
3. For each component in `payload.template.components ?? []`, find the matching `definition.components[i]` by `type` (and, for buttons, by `sub_type` + `index`); if absent, throw `TemplateError`. A button `index` SHALL be accepted as either a string (`"0"`) or a number (`0`) representing a whole number ≥ 0; anything else throws `TemplateError`.
4. For a `HEADER` definition whose `format` is `IMAGE`, `VIDEO`, `DOCUMENT` or `LOCATION`, assert the payload header carries exactly one parameter and that its `type` equals the lower-cased format.
5. For a text component of a positional template, compute the placeholder count via `countTemplatePlaceholders` and assert `parameters.length === expected`.
6. For a text component of a `parameter_format: "NAMED"` template (declared on the definition, or inferred when the text contains a non-numeric placeholder), assert every parameter carries a non-empty `parameter_name`, no name is repeated, and the set of names equals the set of `{{name}}` placeholders in the definition text.
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

#### Scenario: Numeric button index is accepted
- **WHEN** the definition has two buttons and the payload includes `{ type: "button", sub_type: "url", index: 1, parameters: [...] }`
- **THEN** `validateTemplateSend` returns without throwing

#### Scenario: Fractional or negative button index throws
- **WHEN** the payload button `index` is `0.5`, `-1`, or `"abc"`
- **THEN** the call throws `TemplateError`

#### Scenario: Media header with exactly one matching parameter passes
- **WHEN** the definition has `{ type: "HEADER", format: "IMAGE" }` and the payload header has `parameters: [{ type: "image", image: { link } }]`
- **THEN** `validateTemplateSend` returns without throwing

#### Scenario: Media header with zero parameters throws
- **WHEN** the definition has `{ type: "HEADER", format: "IMAGE" }` and the payload header has `parameters: []`
- **THEN** the call throws `TemplateError`
- **AND** the message says the header expects exactly 1 `image` parameter

#### Scenario: Media header with a mismatched parameter type throws
- **WHEN** the definition has `{ type: "HEADER", format: "IMAGE" }` and the payload header parameter is `{ type: "video", … }`
- **THEN** the call throws `TemplateError`
- **AND** the message names the expected type `"image"` and the provided type `"video"`

#### Scenario: Named template with matching names in any order passes
- **WHEN** the definition has `parameter_format: "NAMED"` and body text `"Hi {{customer_name}}, see you at {{time}}."` and the payload body has parameters named `time` and `customer_name`
- **THEN** `validateTemplateSend` returns without throwing

#### Scenario: Named template parameter without parameter_name throws
- **WHEN** a body parameter on a NAMED template omits `parameter_name`
- **THEN** the call throws `TemplateError`

#### Scenario: Named template with missing or unexpected names throws
- **WHEN** the payload provides `customer_name` and `tiem` against placeholders `customer_name` and `time`
- **THEN** the call throws `TemplateError`
- **AND** the message lists `{{time}}` as missing and `tiem` as unexpected

## ADDED Requirements

### Requirement: Named placeholder helpers
The package SHALL export `listTemplatePlaceholders(text)` (every raw `{{…}}` token, de-duplicated, in order of first appearance), `hasNamedTemplatePlaceholders(text)` (`true` when any token is non-numeric), and `extractNamedTemplatePlaceholders(text)` (unique names in order; throws `TemplateError` when a positional `{{N}}` token is mixed with named ones). `TemplateDefinition` SHALL carry an optional `parameter_format: "POSITIONAL" | "NAMED"`, and the text-bearing `TemplateParameter` variants (`text`, `currency`, `date_time`) SHALL accept an optional `parameter_name`.

#### Scenario: listTemplatePlaceholders returns raw tokens in order
- **WHEN** `listTemplatePlaceholders("{{2}} {{name}} {{2}} {{ 1 }}")`
- **THEN** the return value is `["2", "name", "1"]`

#### Scenario: hasNamedTemplatePlaceholders distinguishes positional from named
- **WHEN** called with `"Hi {{1}} and {{2}}"` and with `"Hi {{customer_name}}"`
- **THEN** the return values are `false` and `true` respectively

#### Scenario: extractNamedTemplatePlaceholders rejects mixed templates
- **WHEN** `extractNamedTemplatePlaceholders("Hi {{customer_name}} {{1}}")`
- **THEN** the call throws `TemplateError`
