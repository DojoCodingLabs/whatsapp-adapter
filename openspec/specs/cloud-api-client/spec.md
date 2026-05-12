# cloud-api-client Specification

## Purpose
TBD - created by archiving change bootstrap-whatsapp-adapter. Update Purpose after archive.
## Requirements
### Requirement: Client construction with typed credentials

The package SHALL export a `WhatsAppClient` class whose constructor accepts a single options object of shape `{ phoneNumberId: string; wabaId: string; token: string | TokenProvider; appSecret: string; graphApiVersion?: string }`, where `TokenProvider = () => string | Promise<string>`. The constructor SHALL store the resolved credentials but SHALL NOT perform any network I/O AND SHALL NOT invoke a `TokenProvider` callback at construction time. The package SHALL export the `TokenProvider` type for consumers who want to type their own provider implementations.

#### Scenario: Construction without `graphApiVersion`

- **WHEN** the constructor is called without `graphApiVersion`
- **THEN** `instance.graphApiVersion` equals the exported `GRAPH_API_VERSION` constant (currently `"v25.0"`)

#### Scenario: Construction with a string token (legacy shape)

- **WHEN** the constructor is called with `token: "ABC"`
- **THEN** the instance is constructed successfully
- **AND** the first request's Authorization header is `Bearer ABC`

#### Scenario: Construction with a TokenProvider callback

- **WHEN** the constructor is called with `token: () => "ABC"`
- **THEN** the instance is constructed successfully
- **AND** the callback is NOT invoked during construction
- **AND** the first request's Authorization header is `Bearer ABC`

#### Scenario: Construction with an async TokenProvider callback

- **WHEN** the constructor is called with `token: async () => "ABC"`
- **THEN** the instance is constructed successfully
- **AND** the first request resolves the Promise and uses the result

### Requirement: Credential validation at construction time

The constructor SHALL throw `MissingCredentialsError` if `phoneNumberId`, `wabaId`, `appSecret` is missing or empty, OR if `token` is neither a non-empty string nor a function. The error message SHALL name the missing field(s) but SHALL NOT include the value of any credential. A `TokenProvider` callback's runtime behaviour (whether it throws, returns empty, returns a non-string) SHALL NOT be validated at construction; it is validated per request and SHALL throw `AuthenticationError` at that time.

#### Scenario: Missing token (neither string nor function)

- **WHEN** the constructor is called with `token` set to `undefined`, `null`, `""`, `0`, or `{}`
- **THEN** a `MissingCredentialsError` is thrown
- **AND** `error.code === "MISSING_CREDENTIALS"`
- **AND** `error.missingFields` contains `"token"`

#### Scenario: Multiple missing fields

- **WHEN** the constructor is called with empty `wabaId` AND empty `appSecret`
- **THEN** a `MissingCredentialsError` is thrown listing both `"wabaId"` and `"appSecret"` in `error.missingFields`

#### Scenario: Credential value never appears in error

- **WHEN** the constructor is called with a non-empty `token` but empty `wabaId`
- **THEN** the thrown error's `message` and JSON serialization SHALL NOT contain the substring of `token`

#### Scenario: TokenProvider callback is not invoked at construction

- **WHEN** the constructor is called with `token: () => { throw new Error("boom") }`
- **THEN** the instance is constructed successfully
- **AND** the error is not surfaced until the first request

### Requirement: Pinned Graph API version exported as a constant

The package SHALL export a `GRAPH_API_VERSION` constant whose default value is the currently supported Meta Graph API version (`"v25.0"` at time of writing). The package SHALL also export a `META_GRAPH_BASE_URL` constant resolving to `"https://graph.facebook.com"`.

#### Scenario: GRAPH_API_VERSION is a string starting with "v"

- **WHEN** the consumer imports `GRAPH_API_VERSION` from `@dojocoding/whatsapp`
- **THEN** the imported value is a non-empty string
- **AND** it matches the pattern `/^v\d+\.\d+$/`

### Requirement: Authenticated Graph API request method

The `WhatsAppClient` SHALL expose an `@internal` `request<T>(method, path, body?, options?)` method that issues an authenticated HTTP request against `${META_GRAPH_BASE_URL}/${graphApiVersion}/${path}`. The method SHALL resolve the bearer token per request via the `TokenProvider` callback (or by reading the stored string), set `Authorization: Bearer ${resolvedToken}`, `Content-Type: application/json` (when a body is provided), and `Accept: application/json` headers. On a 2xx response, the method SHALL parse the JSON body and resolve to it as `T`. On any non-2xx, the method SHALL throw a typed `WhatsAppError` produced by the error-code mapper.

The token SHALL be resolved exactly once per outer `request()` invocation, INSIDE the retry loop's fetch step, so all attempts within a single request use the same resolved value (re-resolving mid-retry would mask a stale-token bug).

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

#### Scenario: TokenProvider callback is invoked exactly once per request

- **WHEN** a `WhatsAppClient` is constructed with a callback that increments a counter, AND `request()` is called 3 times sequentially
- **THEN** the counter is `3` (one invocation per outer request)
- **AND** even if retries occur within a single request, the counter does not increment for the same outer request

#### Scenario: TokenProvider callback returns empty string

- **WHEN** a `WhatsAppClient` is constructed with `token: () => ""` AND `request("GET", "/me")` is called
- **THEN** `request()` throws an `AuthenticationError` BEFORE any HTTP request is made
- **AND** `error.code === "AUTHENTICATION"`

#### Scenario: TokenProvider callback throws

- **WHEN** a `WhatsAppClient` is constructed with `token: () => { throw new Error("provider boom") }` AND `request()` is called
- **THEN** `request()` throws an `AuthenticationError` BEFORE any HTTP request is made
- **AND** the `AuthenticationError` references the underlying provider error in its `cause` field

### Requirement: URL construction uses the resolved Graph API version

The `request()` method SHALL prefix the path with the client's resolved `graphApiVersion` (default `GRAPH_API_VERSION`, override via constructor). Leading slashes on the path argument SHALL be tolerated (one or zero).

#### Scenario: Default version is used in the URL

- **WHEN** a client constructed without `graphApiVersion` calls `request("GET", "/PNID/messages")`
- **THEN** the request URL is `https://graph.facebook.com/v25.0/PNID/messages`

#### Scenario: Custom version override is honoured

- **WHEN** a client constructed with `graphApiVersion: "v23.0"` calls `request("GET", "/PNID/messages")`
- **THEN** the request URL is `https://graph.facebook.com/v23.0/PNID/messages`

#### Scenario: Path without a leading slash is also accepted

- **WHEN** a client calls `request("POST", "PNID/messages", {...})`
- **THEN** the request URL is `https://graph.facebook.com/v25.0/PNID/messages` (no double slash)

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

### Requirement: Public health check
The `WhatsAppClient` SHALL expose a public `healthCheck(): Promise<TokenInfo>` method that calls `GET /debug_token?input_token=${token}` and returns a typed `TokenInfo` shape `{ valid: boolean; expiresAt: number | null; appId: string | null; userId: string | null; scopes: string[] }`. The method SHALL throw a typed `WhatsAppError` if the call fails or the response indicates `valid: false`.

#### Scenario: Healthy token resolves with TokenInfo
- **WHEN** `healthCheck()` is called and Meta returns `{ data: { is_valid: true, expires_at: 1735689600, app_id: "APP", user_id: "USR", scopes: ["whatsapp_business_management"] } }`
- **THEN** the method resolves with `{ valid: true, expiresAt: 1735689600000, appId: "APP", userId: "USR", scopes: ["whatsapp_business_management"] }`

#### Scenario: Invalid token throws WhatsAppError
- **WHEN** `healthCheck()` is called and Meta returns `{ data: { is_valid: false, error: { code: 190, message: "Invalid OAuth access token" } } }`
- **THEN** the method throws a `WhatsAppError`
- **AND** `error.message` includes "Invalid OAuth access token"

### Requirement: Optional WindowTracker on the WhatsAppClient
`WhatsAppClientOptions` SHALL accept an optional `windowTracker?: WindowTracker`. When set, free-form convenience send methods (`sendText`, `sendImage`, `sendVideo`, `sendAudio`, `sendDocument`, `sendSticker`, `sendLocation`, `sendContacts`, `sendInteractive`) SHALL pre-flight-check `windowTracker.isWindowOpen(to)` and SHALL throw `WindowClosedError(to)` BEFORE issuing the HTTP request when the window is closed. `sendTemplate` and `sendReaction` SHALL be window-exempt and SHALL NOT consult the tracker.

#### Scenario: Free-form send is gated when window is closed
- **WHEN** the client has a `WindowTracker` configured for which `isWindowOpen("X")` returns `false`
- **AND** `client.sendText({ to: "X", body: "hi" })` is called
- **THEN** the call rejects with `WindowClosedError`
- **AND** no outbound HTTP request is issued

#### Scenario: Free-form send proceeds when window is open
- **WHEN** the client has a `WindowTracker` and `notifyInbound("X")` was just called
- **AND** `client.sendText({ to: "X", body: "hi" })` is called
- **THEN** the request reaches the Graph API and resolves with the parsed response

#### Scenario: sendTemplate is window-exempt
- **WHEN** the client has a `WindowTracker` for which `isWindowOpen("X")` returns `false`
- **AND** `client.sendTemplate({ to: "X", name: "hello_world", language: "en_US" })` is called
- **THEN** the request reaches the Graph API; the tracker is NOT consulted

#### Scenario: sendReaction is window-exempt
- **WHEN** the same closed-window state holds and `client.sendReaction({ to: "X", messageId: "wamid.x", emoji: "👍" })` is called
- **THEN** the request reaches the Graph API

#### Scenario: No tracker configured leaves all sends ungated
- **WHEN** the client has NO `windowTracker` and the customer has never messaged the business
- **AND** `client.sendText(...)` is called
- **THEN** the request reaches the Graph API (Meta will reject with 131026, surfaced as `WindowClosedError` via `mapMetaError` — same end behaviour, just slower)

### Requirement: Every Graph API request emits an OTel span
`WhatsAppClient.request<T>()` (and the underlying `request()` helper) SHALL wrap each call in a `withSpan("whatsapp.request", …)`. The span SHALL carry attributes:
- `whatsapp.phone_number_id` — hashed via `hashPhoneNumberId`
- `whatsapp.method` — the HTTP method
- `whatsapp.path` — the path (without the version prefix)
- `whatsapp.idempotency_key` — the generated UUID v4
- on error: `whatsapp.error.code` (the typed error's `code` discriminator)
- on rate-limit error: `whatsapp.error.meta_code` (the Meta error code)

The span SHALL be recorded with `SpanStatusCode.ERROR` when the typed error propagates, and `OK` (or unset) on success. Span names SHALL NOT include the raw `phone_number_id`.

#### Scenario: A successful request emits a span with hashed phoneNumberId
- **WHEN** `client.request("GET", "/me")` succeeds
- **THEN** the test harness's exporter records a span named `whatsapp.request`
- **AND** `attributes["whatsapp.phone_number_id"]` is a 16-char hex
- **AND** `attributes["whatsapp.phone_number_id"]` is NOT the raw `phoneNumberId`

#### Scenario: A failed request records the error
- **WHEN** the Graph API returns 400 with code 131056 (RateLimitError)
- **THEN** the exported span has `status.code === SpanStatusCode.ERROR`
- **AND** `attributes["whatsapp.error.code"] === "RATE_LIMIT"`
- **AND** `attributes["whatsapp.error.meta_code"] === 131056`

### Requirement: Outbound request correlation

The SDK's HTTP transport SHALL attach a stable per-call
identifier to every outbound Graph API request for correlation
purposes (OTel spans, consumer-side log correlation, support
escalation).

The transport SHALL accept an optional `requestId: string` on
`RequestOptions`. When omitted, the transport SHALL generate a
UUID v4 per logical call. When supplied, the consumer-provided
value SHALL be used verbatim.

The identifier SHALL be:

- Sent as the HTTP header `X-Request-Id: <value>` on every
  outbound request.
- Recorded as the OTel span attribute `whatsapp.request.id` on
  every `whatsapp.request` span.
- Reused across retry attempts of one logical call. The retry
  helper SHALL NOT generate a new id between attempts.

The SDK SHALL NOT advertise outbound idempotency or
deduplication. Meta's Graph API does not consult `X-Request-Id`
for deduplication; consumers requiring real outbound dedup must
wait for the v2 `outbound-deduper` capability.

The legacy header `X-Dojo-Idempotency-Key`, option
`RequestOptions.idempotencyKey`, and span attribute
`whatsapp.idempotency_key` SHALL NOT be emitted. The rename is
breaking under semver but landed pre-1.0 (permitted per
`CONTRIBUTING.md` § Releases).

#### Scenario: Generated `requestId` is reused across retry attempts

- **GIVEN** a `WhatsAppClient.sendText(...)` call with no explicit `requestId`
- **WHEN** the first attempt fails with a transient `5xx` and the retry helper retries
- **THEN** the second attempt's `X-Request-Id` header SHALL match the first's
- **AND** the OTel span SHALL record the same `whatsapp.request.id`

#### Scenario: Consumer-supplied `requestId` is preserved verbatim

- **GIVEN** a `WhatsAppClient.sendText(input, { requestId: "abc-123" })` call
- **WHEN** the request is issued
- **THEN** the outbound HTTP header SHALL be `X-Request-Id: abc-123`
- **AND** the OTel span attribute SHALL be `whatsapp.request.id = "abc-123"`

#### Scenario: Legacy idempotency header is not emitted

- **GIVEN** any outbound Graph API request from `WhatsAppClient`
- **WHEN** the request is inspected
- **THEN** the request SHALL NOT carry an `X-Dojo-Idempotency-Key` header
- **AND** the request SHALL carry exactly one `X-Request-Id` header

