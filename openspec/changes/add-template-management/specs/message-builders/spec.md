## ADDED Requirements

### Requirement: BuildTemplateInput accepts optional validateAgainst
`BuildTemplateInput` SHALL widen with an optional `validateAgainst?: TemplateDefinition` field. When provided, `buildTemplate` SHALL run `validateTemplateSend` (from the `template-management` capability) on the assembled payload and throw `TemplateError` on mismatch. The widening is additive — callers passing only the existing fields continue to work unchanged.

#### Scenario: Without `validateAgainst`, behaviour is unchanged
- **WHEN** `buildTemplate({ to, name, language, components })` is called without `validateAgainst`
- **THEN** the returned payload is identical to the Phase 2 behaviour (no extra validation)

#### Scenario: With `validateAgainst`, mismatches throw before the call returns
- **WHEN** `buildTemplate({ to, name, language, components, validateAgainst })` is called and parameters do not match
- **THEN** the call throws `TemplateError`
