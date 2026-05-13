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

The `WhatsAppClient` SHALL expose three convenience methods
for template sends: `sendTemplate`, `sendAuthTemplate`, and
`sendCarouselTemplate`. Each builds the appropriate payload
and dispatches via the shared `sendMessage` transport
helper.

Template sends are **window-exempt** — they do NOT consult
the 24-hour customer-service window tracker. Templates are
the canonical out-of-window send path.

When the client is constructed with an `optInRegistry`
option, template sends SHALL pre-flight the recipient's
consent state BEFORE issuing the Graph API call. The check
is performed by invoking `optInRegistry.isOptedIn(input.to, { category })`
where `category` is the template's category (sourced from
the build input when available; defaults to `"MARKETING"`
— the strictest gating).

On a `false` return from `isOptedIn`, the client SHALL
throw `OptOutError(recipient, category)` and the Graph API
request SHALL NOT be issued. The error carries the last-4-
digit redacted recipient and the gated category.

When no `optInRegistry` is configured, this pre-flight is a
no-op — the SDK preserves its existing behaviour
(unchanged).

Free-form sends (`sendText`, `sendImage`, etc.) SHALL NOT
consult the `optInRegistry`. Those sends are already gated
by the 24-hour customer-service window, which implies the
customer initiated the conversation (an implicit consent
signal).

The `sendReaction` method SHALL NOT consult the registry —
reactions are part of an existing thread; the customer
already initiated the inbound message being reacted to.

#### Scenario: Opted-out recipient blocks sendTemplate before HTTP

- **GIVEN** a `WhatsAppClient` with `optInRegistry` configured against a registry where the recipient is opted out
- **WHEN** `sendTemplate({ to: "+5210000000001", name: "promo", language: "es_MX" })` is called
- **THEN** the call SHALL throw `OptOutError`
- **AND** no Graph API request SHALL be issued (verifiable via MSW handler count)

#### Scenario: Opted-in recipient proceeds normally

- **GIVEN** a `WhatsAppClient` with `optInRegistry` configured against a registry where the recipient is opted in
- **WHEN** `sendTemplate(...)` is called
- **THEN** the Graph API request SHALL be issued
- **AND** the returned `MessageSendResponse` SHALL match the upstream payload

#### Scenario: No registry configured — pre-flight is a no-op

- **GIVEN** a `WhatsAppClient` with NO `optInRegistry` set
- **WHEN** `sendTemplate(...)` is called
- **THEN** the Graph API request SHALL be issued
- **AND** the call SHALL complete without consulting any consent state

#### Scenario: sendText does not consult the registry

- **GIVEN** a `WhatsAppClient` with `optInRegistry` configured against a registry where the recipient is opted out
- **WHEN** `sendText({ to: "+5210000000001", body: "hi" })` is called
- **THEN** the registry SHALL NOT be consulted (verifiable via spy)
- **AND** the existing 24h-window pre-flight SHALL run as normal

#### Scenario: sendAuthTemplate honours the registry

- **GIVEN** a `WhatsAppClient` with `optInRegistry` configured against a registry where the recipient is opted out of `AUTHENTICATION`
- **WHEN** `sendAuthTemplate(...)` is called
- **THEN** the call SHALL throw `OptOutError`

#### Scenario: sendCarouselTemplate honours the registry

- **GIVEN** a `WhatsAppClient` with `optInRegistry` configured against a registry where the recipient is opted out
- **WHEN** `sendCarouselTemplate(...)` is called
- **THEN** the call SHALL throw `OptOutError`

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

The SDK SHALL retry transient failures using exponential
backoff with full jitter, honouring `Retry-After` when
present, and SHALL classify retryable failures into a small
discriminated set surfaced via `RetryReason`.

`RetryReason` is exported from the package root:

```ts
export type RetryReason =
  | "transient_http" // 408 / 500 / 502 / 503 / 504
  | "rate_limit" // 429 HTTP OR Meta error code 130429
  | "network" // fetch failed (DNS, TCP, TLS)
  | "abort"; // AbortSignal fired mid-request
```

`RetryHooks` SHALL accept an optional `onRetry` callback:

```ts
interface RetryInfo {
  attempt: number; // 1-indexed; the attempt that just failed
  reason: RetryReason;
  delayMs: number; // backoff before the next attempt
  error: unknown; // the caught error
}

interface RetryHooks {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: RetryInfo) => void;
}
```

The `onRetry` hook SHALL be invoked exactly once per scheduled
retry — AFTER the SDK classifies the error as retryable, BEFORE
the backoff sleep. The retry helper SHALL NOT await the hook's
return value (synchronous side-effect only).

When both the SDK's internal retry tracker (used for OTel span
attributes) and a consumer-provided `onRetry` are active, the
internal tracker SHALL fire FIRST, then the consumer hook with
the same `RetryInfo` value. Exceptions thrown by the consumer
hook SHALL NOT break the retry loop (the SDK catches and
silently drops them; the retry proceeds).

`TransientHttpError` SHALL carry a public readonly `status:
number` field naming the HTTP status of the response that
triggered the error. The classifier uses this to distinguish
429 (→ `"rate_limit"`) from other transient statuses
(→ `"transient_http"`).

The SDK SHALL export `classifyRetryReason(err: unknown):
RetryReason | undefined` so consumers writing custom retry
shims can replicate the same classification.

#### Scenario: `onRetry` fires with the same RetryInfo the SDK uses internally

- **GIVEN** a `WhatsAppClient.request(...)` call with a consumer-supplied `retryHooks.onRetry`
- **WHEN** the first attempt fails with a 429 and the retry helper schedules a retry
- **THEN** the consumer's `onRetry` SHALL be invoked exactly once
- **AND** the `RetryInfo.attempt` SHALL be `1`
- **AND** the `RetryInfo.reason` SHALL be `"rate_limit"`
- **AND** the `RetryInfo.delayMs` SHALL be > 0
- **AND** the `RetryInfo.error` SHALL be the caught `TransientHttpError` instance

#### Scenario: Consumer hook throwing does not break retry

- **GIVEN** an `onRetry` that throws an Error
- **WHEN** the first attempt fails with a 503
- **THEN** the SDK SHALL still sleep and retry the call
- **AND** the consumer's exception SHALL be silently dropped (not propagated to the final result)

#### Scenario: TransientHttpError carries the originating status

- **WHEN** Meta returns HTTP 503 and the transport throws
- **THEN** the caught error SHALL be an instance of `TransientHttpError`
- **AND** `error.status` SHALL equal `503`

#### Scenario: `classifyRetryReason` returns `"rate_limit"` for 429 and 130429

- **WHEN** `classifyRetryReason(new TransientHttpError("...", undefined, 429))` is called
- **THEN** the return value SHALL be `"rate_limit"`
- **AND** when `classifyRetryReason(new RateLimitError("...", { metaCode: 130429 }))` is called
- **THEN** the return value SHALL ALSO be `"rate_limit"`

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

