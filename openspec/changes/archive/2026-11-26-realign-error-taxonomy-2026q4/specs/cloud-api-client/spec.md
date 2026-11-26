## ADDED Requirements

### Requirement: Meta envelope is classified before the HTTP status

For a `408` / `429` / `5xx` response whose body is a Meta error envelope, the transport SHALL run `mapMetaError` first. A non-retryable typed result SHALL be thrown on the first attempt (a `RateLimitError` keeps the `Retry-After` hint). A `TransientError` or retryable `RateLimitError` result SHALL be retried by the policy and keep its `metaCode` on exhaustion. An `UNKNOWN` result SHALL keep the existing transient behaviour.

#### Scenario: Permanent code on HTTP 500 is not retried

- **WHEN** Meta answers `POST /{phone-number-id}/messages` with HTTP 500 and body `{ error: { code: 134102, message: "(#134102) Template unavailable for use." } }`
- **THEN** exactly one request is issued
- **AND** the call rejects with `TemplateError` whose `metaCode === 134102`

#### Scenario: Temporary code on HTTP 503 is retried and keeps its code

- **WHEN** Meta answers with HTTP 503 and body `{ error: { code: 131016, … } }` on every attempt of a 4-attempt policy
- **THEN** four requests are issued
- **AND** the call rejects with `TransientError` whose `metaCode === 131016`, `httpStatus === 503` and `attempts === 4`

#### Scenario: Temporary code on HTTP 400 is retried

- **WHEN** Meta answers with HTTP 400 and body `{ error: { code: 131057, … } }` once, then HTTP 200
- **THEN** two requests are issued and the call resolves with the 200 body

#### Scenario: Quality throttle on HTTP 429 is not fast-retried

- **WHEN** Meta answers with HTTP 429, `Retry-After: 30` and body `{ error: { code: 131048, … } }`
- **THEN** exactly one request is issued
- **AND** the call rejects with `RateLimitError` whose `metaCode === 131048` and `retryAfterMs === 30000`

#### Scenario: Unmapped code on HTTP 500 keeps transient behaviour

- **WHEN** Meta answers with HTTP 500 and an envelope whose code is not mapped, on every attempt
- **THEN** the full retry budget is spent
- **AND** the call rejects with `TransientError` whose `httpStatus === 500`

## MODIFIED Requirements

### Requirement: Meta error-code mapper produces typed errors

A `mapMetaError(httpStatus, body)` helper SHALL parse Meta's standard error envelope (`{ error: { code, message, error_subcode?, error_data? } }`) and produce one of the typed error classes from `src/types/errors.ts`, following Meta's Cloud API error-code reference:

- Throttling, retryable within one call's backoff: `4`, `80007`, `130429`, `131056` → `RateLimitError({ metaCode })`; `isRetryableError` SHALL return `true`.
- Throttling, NOT retryable (quality restriction, enforcement window of hours/days, or per-recipient): `131048`, `131049`, `131064`, `131066`, `133016` → `RateLimitError({ metaCode })`; `isRetryableError` SHALL return `false`.
- Temporary ("try again"): `1`, `2`, `131000`, `131016`, `131057`, `133004`, `2494100` → `TransientError({ metaCode, httpStatus })`; `isRetryableError` SHALL return `true`.
- `131047` → `WindowClosedError(<recipient if extractable>)` (re-engagement / 24-hour window).
- `131026` → `UndeliverableError(<recipient if extractable>, { metaCode: 131026, reason: "UNREACHABLE" })` (recipient not on WhatsApp / outdated client / ToS).
- `130403` → `UndeliverableError(<recipient if extractable>, { metaCode: 130403, reason: "RECIPIENT_BLOCKED" })` — the business has blocked the user; never retried; the error `message` SHALL NOT contain the recipient.
- `131050` → `OptOutError(<recipient>, "MARKETING", { metaCode: 131050 })` — recipient stopped marketing messages; authoritative, never retried.
- `368`, `130497`, `131031` (integrity), `131042` (payment method), `33`, `131037`, `131045`, `133010` (phone-number configuration) → `AccountRestrictedError({ metaCode })`.
- `132xxx` (range) and `134102` → `TemplateError(message, undefined, { metaCode })` — the Meta code SHALL be preserved on `metaCode`.
- `0`, `190`, `200` → `AuthenticationError({ metaCode, subcode })` — `subcode` carries `error_subcode` when present; `200` is "No access token provided".
- `3`, `10`, `131005`, and the range `201`–`299` → `PermissionError({ metaCode })`.
- `100`, `131008`, `131009`, `131021`, `131051`, `131052`, `131053`, `131063`, `131065` → `CapabilityError({ metaCode })` — request-shape, content or endpoint problems. `131053` is NOT a throttle.
- anything else, or non-Meta-shaped body → `WhatsAppError("UNKNOWN", message)`.

The SDK SHALL export `isRateLimitMetaCode(code)` (true for either throttling set), `isTransientMetaCode(code)` and `extractMetaCodeFromBody(body)`.

#### Scenario: Pair rate limit is mapped to RateLimitError

- **WHEN** `mapMetaError(400, { error: { code: 131056, message: "(#131056) pair rate limit" } })` is called
- **THEN** it returns a `RateLimitError`
- **AND** the returned error's `metaCode === 131056`

#### Scenario: WABA-level throttling code is retryable

- **WHEN** `mapMetaError(400, { error: { code: 80007, message: "..." } })` is called
- **THEN** it returns a `RateLimitError` with `metaCode === 80007`
- **AND** `isRetryableError(error) === true`

#### Scenario: Per-user marketing cap is a non-retryable RateLimitError

- **WHEN** `mapMetaError(400, { error: { code: 131049, message: "..." } })` is called
- **THEN** it returns a `RateLimitError` with `metaCode === 131049`
- **AND** `isRetryableError(error) === false`

#### Scenario: Media upload error is a CapabilityError, never retried

- **WHEN** `mapMetaError(400, { error: { code: 131053, message: "Media upload error" } })` is called
- **THEN** it returns a `CapabilityError` with `metaCode === 131053`
- **AND** it is NOT a `RateLimitError`
- **AND** `isRetryableError(error) === false`

#### Scenario: Window-closed code is mapped to WindowClosedError

- **WHEN** `mapMetaError(400, { error: { code: 131047, error_data: { messaging_product: "whatsapp", details: "Re-engagement message" }, message: "(#131047) ..." } })` is called
- **THEN** it returns a `WindowClosedError`

#### Scenario: Undeliverable code is mapped to UndeliverableError

- **WHEN** `mapMetaError(400, { error: { code: 131026, message: "(#131026) Message undeliverable" } })` is called
- **THEN** it returns an `UndeliverableError`
- **AND** it is NOT a `WindowClosedError`

#### Scenario: Marketing opt-out code is mapped to OptOutError

- **WHEN** `mapMetaError(400, { error: { code: 131050, message: "...", error_data: { recipient_phone_number: "521234567890" } } })` is called
- **THEN** it returns an `OptOutError` with `category === "MARKETING"` and `metaCode === 131050`
- **AND** `error.recipient === "***7890"` and the full number appears nowhere on the error

#### Scenario: Integrity codes are mapped to AccountRestrictedError

- **WHEN** `mapMetaError(403, { error: { code: 368, message: "Temporarily blocked" } })` is called
- **THEN** it returns an `AccountRestrictedError` with `metaCode === 368` and `code === "ACCOUNT_RESTRICTED"`

#### Scenario: Template-range code is mapped to TemplateError carrying the code

- **WHEN** `mapMetaError(400, { error: { code: 132012, message: "Number of parameters does not match" } })` is called
- **THEN** it returns a `TemplateError`
- **AND** `error.message` includes the original Meta message
- **AND** `error.metaCode === 132012`

#### Scenario: Auth code 190 is mapped to AuthenticationError

- **WHEN** `mapMetaError(401, { error: { code: 190, error_subcode: 463, message: "Session has expired" } })` is called
- **THEN** it returns an `AuthenticationError`
- **AND** `error.metaCode === 190`
- **AND** `error.subcode === 463`

#### Scenario: Permission codes are mapped to PermissionError

- **WHEN** `mapMetaError(403, { error: { code: 201, message: "Permissions error" } })` is called
- **THEN** it returns a `PermissionError`
- **AND** `error.metaCode === 201`
- **WHEN** `mapMetaError(403, { error: { code: 131005, message: "Access denied" } })` is called
- **THEN** it returns a `PermissionError`
- **AND** `error.metaCode === 131005`

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

#### Scenario: No access token provided is an AuthenticationError

- **WHEN** `mapMetaError(400, { error: { code: 200, message: "(#200) Provide valid app ID" } })` is called
- **THEN** it returns an `AuthenticationError` with `metaCode === 200`
- **AND** it is NOT a `PermissionError`

#### Scenario: Spam rate limit is not retried in-call

- **WHEN** `mapMetaError(400, { error: { code: 131048, message: "(#131048) Spam rate limit hit" } })` is called
- **THEN** it returns a `RateLimitError` with `metaCode === 131048`
- **AND** `isRetryableError(error) === false`

#### Scenario: Recipient blocked is undeliverable and redacted

- **WHEN** `mapMetaError(400, { error: { code: 130403, message: "...", error_data: { recipient_phone_number: "521234567890" } } })` is called
- **THEN** it returns an `UndeliverableError` with `reason === "RECIPIENT_BLOCKED"` and `metaCode === 130403`
- **AND** `error.message` does not contain `521234567890`
- **AND** `isRetryableError(error) === false`

#### Scenario: Payment-method error halts the account

- **WHEN** `mapMetaError(400, { error: { code: 131042, message: "..." } })` is called
- **THEN** it returns an `AccountRestrictedError` with `metaCode === 131042`

#### Scenario: Temporary code is a retryable TransientError

- **WHEN** `mapMetaError(400, { error: { code: 131000, message: "(#131000) Something went wrong" } })` is called
- **THEN** it returns a `TransientError` with `metaCode === 131000` and `httpStatus === 400`
- **AND** `isRetryableError(error) === true`

#### Scenario: Marketing-disabled code is a CapabilityError

- **WHEN** `mapMetaError(400, { error: { code: 131063, message: "..." } })` is called
- **THEN** it returns a `CapabilityError` with `metaCode === 131063`
