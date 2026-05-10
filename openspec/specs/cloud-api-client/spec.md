# cloud-api-client Specification

## Purpose
TBD - created by archiving change bootstrap-whatsapp-adapter. Update Purpose after archive.
## Requirements
### Requirement: Client construction with typed credentials
The package SHALL export a `WhatsAppClient` class whose constructor accepts a single options object of shape `{ phoneNumberId: string; wabaId: string; token: string; appSecret: string; graphApiVersion?: string }`. The constructor SHALL store the resolved credentials but SHALL NOT perform any network I/O.

#### Scenario: Construction with all required credentials
- **WHEN** `new WhatsAppClient({ phoneNumberId: "P", wabaId: "W", token: "T", appSecret: "S" })` is called
- **THEN** an instance is returned
- **AND** `instance.phoneNumberId === "P"` and `instance.wabaId === "W"`
- **AND** no HTTP request is sent to `graph.facebook.com`

#### Scenario: Construction with custom Graph API version
- **WHEN** the constructor is called with `graphApiVersion: "v22.0"`
- **THEN** `instance.graphApiVersion === "v22.0"`

#### Scenario: Construction without `graphApiVersion`
- **WHEN** the constructor is called without `graphApiVersion`
- **THEN** `instance.graphApiVersion` equals the exported `GRAPH_API_VERSION` constant (currently `"v23.0"`)

### Requirement: Credential validation at construction time
The constructor SHALL throw `MissingCredentialsError` if `phoneNumberId`, `wabaId`, `token`, or `appSecret` is missing or empty. The error message SHALL name the missing field(s) but SHALL NOT include the value of any credential.

#### Scenario: Missing token
- **WHEN** the constructor is called with an empty `token`
- **THEN** a `MissingCredentialsError` is thrown
- **AND** `error.code === "MISSING_CREDENTIALS"`
- **AND** `error.missingFields` contains `"token"`

#### Scenario: Multiple missing fields
- **WHEN** the constructor is called with empty `wabaId` AND empty `appSecret`
- **THEN** a `MissingCredentialsError` is thrown listing both `"wabaId"` and `"appSecret"` in `error.missingFields`

#### Scenario: Credential value never appears in error
- **WHEN** the constructor is called with a non-empty `token` but empty `wabaId`
- **THEN** the thrown error's `message` and JSON serialization SHALL NOT contain the substring of `token`

### Requirement: Pinned Graph API version exported as a constant
The package SHALL export a `GRAPH_API_VERSION` constant whose default value is the currently supported Meta Graph API version (`"v23.0"` at time of writing). The package SHALL also export a `META_GRAPH_BASE_URL` constant resolving to `"https://graph.facebook.com"`.

#### Scenario: GRAPH_API_VERSION is a string starting with "v"
- **WHEN** the consumer imports `GRAPH_API_VERSION` from `@dojocoding/whatsapp`
- **THEN** the imported value is a non-empty string
- **AND** it matches the pattern `/^v\d+\.\d+$/`

#### Scenario: Constants are immutable to TypeScript consumers
- **WHEN** a TypeScript consumer attempts `GRAPH_API_VERSION = "v0.0"` in strict mode
- **THEN** the TypeScript compiler reports an error (the export is `as const` / `readonly`)

### Requirement: Authenticated Graph API request method
The `WhatsAppClient` SHALL expose an `@internal` `request<T>(method, path, body?, options?)` method that issues an authenticated HTTP request against `${META_GRAPH_BASE_URL}/${graphApiVersion}/${path}`. The method SHALL set `Authorization: Bearer ${token}`, `Content-Type: application/json` (when a body is provided), and `Accept: application/json` headers. On a 2xx response, the method SHALL parse the JSON body and resolve to it as `T`. On any non-2xx, the method SHALL throw a typed `WhatsAppError` produced by the error-code mapper.

#### Scenario: Successful 200 response is parsed and returned
- **WHEN** `request("GET", "/me")` is called and the server returns `200 { "id": "1" }`
- **THEN** the method resolves to `{ id: "1" }`
- **AND** the request bore `Authorization: Bearer <token>` and `Accept: application/json`

#### Scenario: 4xx with mapped Meta error code surfaces as typed error
- **WHEN** the Graph API returns `400` with body `{ error: { code: 131056, message: "pair rate limit" } }`
- **THEN** `request()` throws a `RateLimitError`
- **AND** `error.metaCode === 131056`
- **AND** `error.code === "RATE_LIMIT"`

#### Scenario: 5xx is surfaced as a `WhatsAppError` after exhausting retries
- **WHEN** the Graph API returns `503` on every attempt and the retry policy exhausts
- **THEN** `request()` throws a `WhatsAppError`
- **AND** `error.code === "UNKNOWN"`

### Requirement: URL construction uses the resolved Graph API version
The `request()` method SHALL prefix the path with the client's resolved `graphApiVersion` (default `GRAPH_API_VERSION`, override via constructor). Leading slashes on the path argument SHALL be tolerated (one or zero).

#### Scenario: Default version is used in the URL
- **WHEN** a client constructed without `graphApiVersion` calls `request("GET", "/PNID/messages")`
- **THEN** the request URL is `https://graph.facebook.com/v23.0/PNID/messages`

#### Scenario: Custom version override is honoured
- **WHEN** a client constructed with `graphApiVersion: "v22.0"` calls `request("GET", "/PNID/messages")`
- **THEN** the request URL is `https://graph.facebook.com/v22.0/PNID/messages`

#### Scenario: Path without a leading slash is also accepted
- **WHEN** a client calls `request("POST", "PNID/messages", {...})`
- **THEN** the request URL is `https://graph.facebook.com/v23.0/PNID/messages` (no double slash)

### Requirement: Retry policy with exponential backoff and full jitter
A `retry(fn, policy)` helper SHALL wrap any async function and retry on transient failures using exponential backoff with full jitter. Default policy: `{ maxAttempts: 4, baseDelayMs: 250, maxDelayMs: 8000, jitter: "full" }`. Retries SHALL fire on:
- HTTP `408`, `429`, or any `5xx`
- Meta error codes `130429`, `131048`, `131056`, `131053`
- `AbortError` and `TypeError: fetch failed` (network)

The policy SHALL NOT retry on:
- HTTP `4xx` other than `408`/`429`
- Meta error codes outside the retryable set (e.g., `131026` window-closed, `132xxx` template errors)
- Synchronous validation errors thrown by the SDK itself (`MissingCredentialsError`, etc.)

When a `Retry-After` header is present (numeric seconds or HTTP-date), the helper SHALL wait at least that long before the next attempt, capped to `maxDelayMs`.

#### Scenario: Retries on 503 and eventually succeeds
- **WHEN** the underlying call returns `503` on attempts 1 and 2, then `200 OK` on attempt 3
- **THEN** the helper resolves with the attempt-3 response
- **AND** total attempts === 3

#### Scenario: Stops retrying once `maxAttempts` is reached
- **WHEN** the underlying call returns `503` on every attempt
- **THEN** the helper throws after exactly `maxAttempts` calls

#### Scenario: Does not retry on a non-retryable 4xx
- **WHEN** the underlying call returns `400` with Meta code `131026` (window closed) on the first attempt
- **THEN** the helper throws immediately
- **AND** total attempts === 1

#### Scenario: Honours numeric Retry-After
- **WHEN** the response includes `Retry-After: 2`
- **THEN** the helper waits at least 2000 ms before the next attempt

#### Scenario: Full jitter spreads attempt timing
- **WHEN** the helper computes the delay before a retry
- **THEN** the delay is a uniformly random value in `[0, min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))]`

### Requirement: Meta error-code mapper produces typed errors
A `mapMetaError(httpStatus, body)` helper SHALL parse Meta's standard error envelope (`{ error: { code, message, error_subcode?, error_data? } }`) and produce one of the typed error classes from `src/types/errors.ts`:
- `131056` → `RateLimitError({ metaCode: 131056 })`
- `131048` → `RateLimitError({ metaCode: 131048 })` (spam detection)
- `130429` → `RateLimitError({ metaCode: 130429 })`
- `131053` → `RateLimitError({ metaCode: 131053 })` (media throttle)
- `131026` → `WindowClosedError(<recipient if extractable>)`
- `132xxx` (range) → `TemplateError(message)`
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

#### Scenario: Unknown shape falls back to WhatsAppError
- **WHEN** `mapMetaError(500, "<html>nginx</html>")` is called
- **THEN** it returns a `WhatsAppError`
- **AND** `error.code === "UNKNOWN"`

### Requirement: Client-side idempotency-key generation
Every call through `request()` SHALL attach a custom header `X-Dojo-Idempotency-Key: <uuid v4>` generated at the start of the logical call. The same key SHALL be reused across all retry attempts of the same call. Meta does not honour the header, but it lets internal logs and the future `mock-mode` correlate retried writes.

#### Scenario: Idempotency key is stable across retries
- **WHEN** `request()` is invoked once and the underlying call retries 3 times
- **THEN** all 3 outbound requests carry the same `X-Dojo-Idempotency-Key` value
- **AND** the value is a valid UUID v4

#### Scenario: Each `request()` invocation gets a fresh key
- **WHEN** `request()` is invoked twice in sequence
- **THEN** the two outbound requests carry two different `X-Dojo-Idempotency-Key` values

### Requirement: Public health check
The `WhatsAppClient` SHALL expose a public `healthCheck(): Promise<TokenInfo>` method that calls `GET /debug_token?input_token=${token}` and returns a typed `TokenInfo` shape `{ valid: boolean; expiresAt: number | null; appId: string | null; userId: string | null; scopes: string[] }`. The method SHALL throw a typed `WhatsAppError` if the call fails or the response indicates `valid: false`.

#### Scenario: Healthy token resolves with TokenInfo
- **WHEN** `healthCheck()` is called and Meta returns `{ data: { is_valid: true, expires_at: 1735689600, app_id: "APP", user_id: "USR", scopes: ["whatsapp_business_management"] } }`
- **THEN** the method resolves with `{ valid: true, expiresAt: 1735689600000, appId: "APP", userId: "USR", scopes: ["whatsapp_business_management"] }`

#### Scenario: Invalid token throws WhatsAppError
- **WHEN** `healthCheck()` is called and Meta returns `{ data: { is_valid: false, error: { code: 190, message: "Invalid OAuth access token" } } }`
- **THEN** the method throws a `WhatsAppError`
- **AND** `error.message` includes "Invalid OAuth access token"

