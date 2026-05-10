## MODIFIED Requirements

### Requirement: Meta error-code mapper produces typed errors

A `mapMetaError(httpStatus, body)` helper SHALL parse Meta's standard error envelope (`{ error: { code, message, error_subcode?, error_data? } }`) and produce one of the typed error classes from `src/types/errors.ts`:

- `131056` → `RateLimitError({ metaCode: 131056 })`
- `131048` → `RateLimitError({ metaCode: 131048 })` (spam detection)
- `130429` → `RateLimitError({ metaCode: 130429 })`
- `131053` → `RateLimitError({ metaCode: 131053 })` (media throttle)
- `131026` → `WindowClosedError(<recipient if extractable>)`
- `132xxx` (range) → `TemplateError(message)`
- `190` → `AuthenticationError({ metaCode: 190, subcode })` — `subcode` carries `error_subcode` when present
- `200`, `210`, `230`, `294`, `299` → `PermissionError({ metaCode })`
- `100` → `CapabilityError({ metaCode: 100 })`
- anything else, or non-Meta-shaped body → `WhatsAppError("UNKNOWN", message)`

#### Scenario: Pair rate limit is mapped to RateLimitError

- **WHEN** `mapMetaError(400, { error: { code: 131056, message: "(#131056) pair rate limit" } })` is called
- **THEN** it returns a `RateLimitError`
- **AND** the returned error's `metaCode === 131056`

#### Scenario: Window-closed code is mapped to WindowClosedError

- **WHEN** `mapMetaError(400, { error: { code: 131026, error_data: { messaging_product: "whatsapp", details: "Re-engagement message" }, message: "(#131026) ..." } })` is called
- **THEN** it returns a `WindowClosedError`

#### Scenario: Template-range code is mapped to TemplateError

- **WHEN** `mapMetaError(400, { error: { code: 132012, message: "Number of parameters does not match" } })` is called
- **THEN** it returns a `TemplateError`
- **AND** `error.message` includes the original Meta message

#### Scenario: Auth code 190 is mapped to AuthenticationError

- **WHEN** `mapMetaError(401, { error: { code: 190, error_subcode: 463, message: "Session has expired" } })` is called
- **THEN** it returns an `AuthenticationError`
- **AND** `error.metaCode === 190`
- **AND** `error.subcode === 463`

#### Scenario: Permission codes are mapped to PermissionError

- **WHEN** `mapMetaError(403, { error: { code: 200, message: "Permissions error" } })` is called
- **THEN** it returns a `PermissionError`
- **AND** `error.metaCode === 200`
- **WHEN** `mapMetaError(403, { error: { code: 210, message: "User not visible" } })` is called
- **THEN** it returns a `PermissionError`
- **AND** `error.metaCode === 210`

#### Scenario: Capability code 100 is mapped to CapabilityError

- **WHEN** `mapMetaError(400, { error: { code: 100, message: "Invalid parameter" } })` is called
- **THEN** it returns a `CapabilityError`
- **AND** `error.metaCode === 100`

#### Scenario: Unknown shape falls back to WhatsAppError

- **WHEN** `mapMetaError(500, "<html>nginx</html>")` is called
- **THEN** it returns a `WhatsAppError`
- **AND** `error.code === "UNKNOWN"`

#### Scenario: Unmapped Meta code falls back to UNKNOWN

- **WHEN** `mapMetaError(400, { error: { code: 191, message: "..." } })` is called
- **THEN** it returns a `WhatsAppError`
- **AND** `error.code === "UNKNOWN"`
