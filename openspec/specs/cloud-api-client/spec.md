# cloud-api-client Specification

## Purpose
TBD - created by archiving change bootstrap-whatsapp-adapter. Update Purpose after archive.
## Requirements
### Requirement: Client construction with typed credentials

The package SHALL export a `WhatsAppClient` class whose constructor accepts a single options object of shape `{ phoneNumberId: string; wabaId: string; token: string | TokenProvider; appSecret: string; graphApiVersion?: string }`, where `TokenProvider = () => string | Promise<string>`. The constructor SHALL store the resolved credentials but SHALL NOT perform any network I/O AND SHALL NOT invoke a `TokenProvider` callback at construction time. The package SHALL export the `TokenProvider` type for consumers who want to type their own provider implementations.

#### Scenario: Construction without `graphApiVersion`

- **WHEN** the constructor is called without `graphApiVersion`
- **THEN** `instance.graphApiVersion` equals the exported `GRAPH_API_VERSION` constant (currently `"v26.0"`)

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

The package SHALL export a `GRAPH_API_VERSION` constant whose default value is the currently supported Meta Graph API version (`"v26.0"` at time of writing). The package SHALL also export a `META_GRAPH_BASE_URL` constant resolving to `"https://graph.facebook.com"`.

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
- **THEN** the request URL is `https://graph.facebook.com/v26.0/PNID/messages`

#### Scenario: Custom version override is honoured

- **WHEN** a client constructed with `graphApiVersion: "v23.0"` calls `request("GET", "/PNID/messages")`
- **THEN** the request URL is `https://graph.facebook.com/v23.0/PNID/messages`

#### Scenario: Path without a leading slash is also accepted

- **WHEN** a client calls `request("POST", "PNID/messages", {...})`
- **THEN** the request URL is `https://graph.facebook.com/v26.0/PNID/messages` (no double slash)

### Requirement: Retry policy with exponential backoff and full jitter

The SDK SHALL retry transient failures using exponential
backoff with full jitter, honouring `Retry-After` when
present, and SHALL classify retryable failures into a small
discriminated set surfaced via `RetryReason`.

`RetryReason` is exported from the package root:

```ts
export type RetryReason =
  | "transient_http" // 408 / 500 / 502 / 503 / 504
  | "rate_limit" // 429 HTTP OR a retryable Meta throttling code
  | "network" // fetch failed (DNS, TCP, TLS)
  | "abort"; // AbortError NOT raised by the caller's own signal
```

`RetryHooks` SHALL accept an optional `onRetry` callback and an
optional `signal`:

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
  signal?: AbortSignal; // caller cancellation; never retried
}
```

**A caller-initiated abort SHALL NOT be retried.** The transport
SHALL pass `RequestOptions.signal` as `RetryHooks.signal`. When
that signal is aborted the retry loop SHALL rethrow the failure at
once without scheduling a retry or invoking `onRetry`, and a
backoff sleep already in progress SHALL end early with the
signal's `reason` (or a standard `AbortError`) so the caller's
cancellation is honoured on the spot. Only `AbortError`s that are
NOT the caller's own signal (a fetch implementation's internal
timeout, for instance) remain retryable with reason `"abort"`.

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
triggered the error, and an optional `metaCode` parsed from a
Meta envelope in that response body. The classifier uses
`status` to distinguish 429 (→ `"rate_limit"`) from other
transient statuses (→ `"transient_http"`).

`TransientHttpError` is a per-attempt marker internal to the
retry loop. **Every error that leaves `WhatsAppClient.request()`
SHALL be a `WhatsAppError`.** When the retry budget is exhausted
the transport SHALL convert the final failure, keeping the
original as `cause`:

- `TransientHttpError` with `status === 429` or a Meta throttling
  `metaCode` → `RateLimitError({ metaCode?, retryAfterMs? })`.
- any other `TransientHttpError` → `TransientError({ httpStatus, attempts, retryAfterMs? })`.
- `TypeError: fetch failed` (network) → `NetworkError`.
- `AbortError` → `RequestAbortedError`.
- anything else → `WhatsAppError("UNKNOWN")`.

A `2xx` response whose body is not valid JSON SHALL throw
`WhatsAppError("UNKNOWN", …, { cause: SyntaxError })` from the
first attempt and SHALL NOT be retried (the request most likely
succeeded on Meta's side).

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

#### Scenario: Exhausted 503 surfaces TransientError

- **WHEN** Meta returns HTTP 503 with `Retry-After: 2` on every attempt of a 3-attempt policy
- **THEN** the call rejects with `TransientError`
- **AND** `error.httpStatus === 503`, `error.attempts === 3`, `error.retryAfterMs === 2000`
- **AND** `error.cause` is the last `TransientHttpError`
- **AND** the error is NOT an instance of `TransientHttpError`

#### Scenario: Exhausted 429 surfaces RateLimitError

- **WHEN** Meta returns HTTP 429 without a Meta envelope on every attempt
- **THEN** the call rejects with `RateLimitError`
- **AND** `error.metaCode` is `undefined` and `error.retryAfterMs` reflects the header

#### Scenario: Exhausted 429 with a Meta throttling envelope preserves the code

- **WHEN** Meta returns HTTP 429 with body `{ error: { code: 80007, … } }` on every attempt
- **THEN** the call rejects with `RateLimitError`
- **AND** `error.metaCode === 80007`

#### Scenario: Non-JSON 2xx is not retried

- **WHEN** Meta returns HTTP 200 with an HTML body to `POST /messages`
- **THEN** exactly one request is issued
- **AND** the call rejects with `WhatsAppError` whose `code === "UNKNOWN"` and whose `cause` is a `SyntaxError`

#### Scenario: Network failure surfaces NetworkError

- **WHEN** `fetch` rejects with `TypeError: fetch failed` on every attempt
- **THEN** the call rejects with `NetworkError`
- **AND** `error.cause` is the `TypeError`

#### Scenario: Aborted request surfaces RequestAbortedError

- **WHEN** the caller's `AbortSignal` is aborted
- **THEN** the call rejects with `RequestAbortedError` (`code === "ABORTED"`)
- **AND** `error.cause.name === "AbortError"`

#### Scenario: Caller abort is not retried under the default policy

- **GIVEN** a `WhatsAppClient.request(...)` call with a pre-aborted `signal` and the default 4-attempt policy
- **WHEN** the first attempt fails with `AbortError`
- **THEN** exactly one attempt is made
- **AND** `onRetry` is never invoked and no backoff sleep occurs
- **AND** the call rejects with `RequestAbortedError`

#### Scenario: Abort during backoff cuts the sleep short

- **GIVEN** a retry loop sleeping after a 503
- **WHEN** the caller's `signal` aborts mid-sleep
- **THEN** the sleep ends immediately
- **AND** no further attempt is made
- **AND** the loop rejects with the signal's `reason` when it is an `Error`, else an `AbortError`

#### Scenario: Non-caller AbortError is still retryable

- **WHEN** `fn` throws an `AbortError` and no `signal` was supplied (or the supplied signal is not aborted)
- **THEN** the retry loop schedules a retry with reason `"abort"`

#### Scenario: `classifyRetryReason` returns `"rate_limit"` for 429 and 130429

- **WHEN** `classifyRetryReason(new TransientHttpError("...", undefined, 429))` is called
- **THEN** the return value SHALL be `"rate_limit"`
- **AND** when `classifyRetryReason(new RateLimitError("...", { metaCode: 130429 }))` is called
- **THEN** the return value SHALL ALSO be `"rate_limit"`

### Requirement: Meta error-code mapper produces typed errors

A `mapMetaError(httpStatus, body)` helper SHALL parse Meta's standard error envelope (`{ error: { code, message, error_subcode?, error_data? } }`) and produce one of the typed error classes from `src/types/errors.ts`, following Meta's Cloud API error-code reference:

- Throttling, retryable within one call's backoff: `4`, `80007`, `130429`, `131048`, `131056` → `RateLimitError({ metaCode })`; `isRetryableError` SHALL return `true`.
- Throttling, NOT retryable (enforcement window is hours/days or per-recipient): `131049`, `131064`, `133016` → `RateLimitError({ metaCode })`; `isRetryableError` SHALL return `false`.
- `131047` → `WindowClosedError(<recipient if extractable>)` (re-engagement / 24-hour window).
- `131026` → `UndeliverableError(<recipient if extractable>)` (recipient not on WhatsApp / outdated client / ToS).
- `131050` → `OptOutError(<recipient>, "MARKETING", { metaCode: 131050 })` — recipient stopped marketing messages; authoritative, never retried.
- `368`, `130497`, `131031` → `AccountRestrictedError({ metaCode })` — integrity enforcement on the WABA / phone number.
- `132xxx` (range) → `TemplateError(message, undefined, { metaCode })` — the Meta code SHALL be preserved on `metaCode`.
- `0`, `190` → `AuthenticationError({ metaCode, subcode })` — `subcode` carries `error_subcode` when present.
- `3`, `10`, `200`, `210`, `230`, `294`, `299`, `131005` → `PermissionError({ metaCode })`.
- `100`, `131008`, `131009`, `131051`, `131052`, `131053` → `CapabilityError({ metaCode })` — request-shape or content problems, including media upload/download failures. `131053` is NOT a throttle.
- anything else, or non-Meta-shaped body → `WhatsAppError("UNKNOWN", message)`.

The SDK SHALL export `isRateLimitMetaCode(code)` (true for either throttling set) and `extractMetaCodeFromBody(body)`.

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

- **WHEN** `mapMetaError(403, { error: { code: 200, message: "Permissions error" } })` is called
- **THEN** it returns a `PermissionError`
- **AND** `error.metaCode === 200`
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
`WhatsAppClientOptions` SHALL accept an optional `windowTracker?: WindowTracker`. When set, free-form convenience send methods (`sendText`, `sendImage`, `sendVideo`, `sendAudio`, `sendVoice`, `sendDocument`, `sendSticker`, `sendLocation`, `sendContacts`, `sendInteractive`, `sendReaction`, and `sendReply` with a non-template payload) SHALL pre-flight-check `windowTracker.isWindowOpen(to)` and SHALL throw `WindowClosedError(to)` BEFORE issuing the HTTP request when the window is closed. Only approved-template sends (`sendTemplate`, `sendAuthTemplate`, `sendCarouselTemplate`) SHALL be window-exempt and SHALL NOT consult the tracker. Reactions are NOT exempt — Meta rejects an out-of-window reaction with `131047`.

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

#### Scenario: sendReaction is window-gated
- **WHEN** the same closed-window state holds and `client.sendReaction({ to: "X", messageId: "wamid.x", emoji: "👍" })` is called
- **THEN** the call rejects with `WindowClosedError`
- **AND** no outbound HTTP request is issued

#### Scenario: No tracker configured leaves all sends ungated
- **WHEN** the client has NO `windowTracker` and the customer has never messaged the business
- **AND** `client.sendText(...)` is called
- **THEN** the request reaches the Graph API (Meta will reject with `131047`, surfaced as `WindowClosedError` via `mapMetaError` — same end behaviour, just slower)

### Requirement: Every Graph API request emits an OTel span
`WhatsAppClient.request<T>()` (and the underlying `request()` helper) SHALL wrap each call in a `withSpan("whatsapp.request", …)`. The span SHALL carry attributes:
- `whatsapp.phone_number_id` — hashed via `hashPhoneNumberId`
- `whatsapp.method` — the HTTP method
- `whatsapp.path` — the path component only (without the version prefix and **without the query string**). Anything from the first `?` onward SHALL be stripped before the attribute is attached, so credential-bearing query parameters such as `/debug_token?input_token=…` never reach an exporter.
- `whatsapp.request.id` — the per-call request id (UUID v4 unless supplied)
- on error: `whatsapp.error.code` (the typed error's `code` discriminator)
- on rate-limit error: `whatsapp.error.meta_code` (the Meta error code)

The span SHALL be recorded with `SpanStatusCode.ERROR` when the typed error propagates, and `OK` (or unset) on success. Span names SHALL NOT include the raw `phone_number_id`. No span attribute SHALL contain the bearer token.

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

#### Scenario: healthCheck span never carries the bearer token
- **WHEN** `client.healthCheck()` is called with token `"SECRET-TOKEN"`
- **THEN** the exported `whatsapp.request` span has `attributes["whatsapp.path"] === "/debug_token"`
- **AND** no string attribute value on that span contains `"SECRET-TOKEN"`

#### Scenario: Query strings are stripped from whatsapp.path
- **WHEN** `client.request("GET", "/me?fields=id")` is called
- **THEN** the outbound URL still includes `?fields=id`
- **AND** the exported span has `attributes["whatsapp.path"] === "/me"`

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

### Requirement: Media-bytes downloads go through the transport
The package SHALL expose `fetchExternal(client, url, options?)` in the client layer: an authenticated `GET` of a non-Graph URL (Meta's media CDN) that resolves to a `Uint8Array`. It SHALL send `Authorization: Bearer <token>` and `X-Request-Id`, honour `options.fetchImpl`, `options.signal`, `options.retryPolicy` and `options.retryHooks`, retry `408` / `429` / `5xx` with the same backoff and `Retry-After` handling as `request()`, and wrap every escaping failure into a `WhatsAppError` subclass exactly as `request()` does (`RateLimitError`, `TransientError`, `NetworkError`, `RequestAbortedError`).

A CDN response of `401`, `403`, `404` or `410` SHALL throw `MediaExpiredError` (`code: "MEDIA_EXPIRED"`, `httpStatus`, optional `mediaId`) without retrying. Any other non-2xx SHALL throw `WhatsAppError("UNKNOWN")` naming the status. Neither message SHALL contain the URL.

`DownloadedMedia.fetchBytes(options?)` and the exported `fetchMediaUrl(client, url, options?)` SHALL delegate to `fetchExternal`. `downloadMedia(mediaId, options)` SHALL pass its `retryPolicy`, `retryHooks` and `fetchImpl` on to `fetchBytes()` as defaults (not `signal` / `requestId`). `fetchMediaUrl` SHALL additionally accept a bare `AbortSignal` as its third argument.

#### Scenario: fetchBytes sends the bearer to the CDN and returns the body
- **GIVEN** `GET /{media-id}` returns `{ url: <cdn-url>, mime_type, sha256, file_size, id }`
- **WHEN** `const m = await client.downloadMedia(id); await m.fetchBytes({ requestId: "corr-1" })`
- **THEN** the CDN receives `Authorization: Bearer <token>` and `X-Request-Id: corr-1`
- **AND** the resolved `Uint8Array` equals the response body

#### Scenario: Expired URL surfaces as MediaExpiredError without retry
- **GIVEN** the CDN answers `403`
- **WHEN** `m.fetchBytes({ retryPolicy: { maxAttempts: 3, … } })` is awaited
- **THEN** it rejects with `MediaExpiredError` whose `httpStatus === 403` and `mediaId === id`
- **AND** the CDN was hit exactly once
- **AND** `error.message` does not contain the URL's query string

#### Scenario: CDN 503 is retried and surfaces TransientError
- **GIVEN** the CDN answers `503` on every attempt and `maxAttempts: 3`
- **WHEN** `m.fetchBytes()` is awaited
- **THEN** it rejects with `TransientError` (`httpStatus === 503`) after 3 attempts
- **AND** the `whatsapp.media.fetch` span has `whatsapp.retry.count === 2`

#### Scenario: CDN 429 honours Retry-After
- **GIVEN** the CDN answers `429` with `Retry-After: 2` and a policy with `maxDelayMs ≥ 2000`
- **WHEN** `m.fetchBytes()` is awaited with a stubbed `sleep`
- **THEN** `sleep` is called with `2000`
- **AND** the call rejects with `RateLimitError` whose `retryAfterMs === 2000`

#### Scenario: fetchImpl is honoured on both steps
- **WHEN** `client.downloadMedia(id, { fetchImpl })` is followed by `fetchBytes()`
- **THEN** `fetchImpl` is called for the Graph lookup and again for the CDN URL, and the global `fetch` is never used

#### Scenario: fetchMediaUrl accepts a bare AbortSignal
- **WHEN** `fetchMediaUrl(client, url, new AbortController().signal)` is called
- **THEN** it behaves as `fetchMediaUrl(client, url, { signal })`

### Requirement: Media-bytes downloads emit an OTel span
Every `fetchExternal` call SHALL be wrapped in `withSpan("whatsapp.media.fetch", …)` carrying `whatsapp.method` (`"GET"`), `whatsapp.media.host` (the URL's host only), `whatsapp.phone_number_id` (hashed), `whatsapp.request.id`, `whatsapp.retry.count` (always), `whatsapp.retry.reason` (when count > 0) and, on failure, `whatsapp.error.code`. No attribute SHALL contain the URL path or query string, the bearer token, or the raw `phone_number_id`.

#### Scenario: Span carries the host but not the signed query
- **GIVEN** a CDN URL `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=…&hash=SECRET`
- **WHEN** `fetchBytes()` succeeds
- **THEN** a span named `whatsapp.media.fetch` is exported with `whatsapp.media.host === "lookaside.fbsbx.com"`
- **AND** no string attribute contains `hash=`, the bearer token, or the raw phone-number id

### Requirement: Input-shape errors are typed WhatsAppErrors
Every public method's own input validation (`uploadMedia`, `downloadMedia`, `fetchMediaUrl`, `markAsRead` / `buildMarkReadPayload`, `getTemplate`, `sendReply`) SHALL throw or reject with `WhatsAppError("UNKNOWN", …)` — never a bare `TypeError` or `Error` — before any HTTP call. Oversize uploads SHALL throw `WhatsAppError("CAPABILITY", …)`. `media/upload.ts` SHALL export `validateUploadInput(input): number` (shape + size gate, returns byte length), `assertSizeAllowed` and `payloadByteLength`.

#### Scenario: Empty mediaId
- **WHEN** `client.downloadMedia("")` is awaited
- **THEN** it rejects with a `WhatsAppError` whose `code === "UNKNOWN"` and which is not an `instanceof TypeError`
- **AND** no HTTP request is made

#### Scenario: Empty wamid on markAsRead
- **WHEN** `client.markAsRead({ messageId: "" })` is awaited
- **THEN** it rejects with `WhatsAppError("UNKNOWN")` and no HTTP request is made

#### Scenario: Oversize upload
- **WHEN** `client.uploadMedia({ file: new Uint8Array(5 * 1024 * 1024 + 1), mimeType: "image/jpeg" })` is awaited
- **THEN** it rejects with `WhatsAppError` whose `code === "CAPABILITY"` and no HTTP request is made

#### Scenario: sendReply with empty wamid
- **WHEN** `client.sendReply("", buildText({ to, body: "x" }))` is awaited
- **THEN** it rejects with `WhatsAppError("UNKNOWN")`

### Requirement: uploadMedia and markAsRead HTTP contract
`uploadMedia` SHALL `POST /{phone-number-id}/media` as `multipart/form-data` with parts `messaging_product=whatsapp`, `type=<mimeType>` and `file=<Blob>` (filename from `input.filename`, default `upload`), letting `fetch` set the multipart boundary. `markAsRead` SHALL `POST /{phone-number-id}/messages` with `{ messaging_product: "whatsapp", status: "read", message_id }` plus `typing_indicator: { type: "text" }` when `typing === true`, and SHALL NOT consult the `WindowTracker`. Both SHALL map Meta error envelopes through `mapMetaError` and retry through the standard policy.

#### Scenario: Upload wire shape
- **WHEN** `client.uploadMedia({ file: bytes, mimeType: "image/jpeg", filename: "a.jpg" })` is awaited against a stub returning `{ id: "MEDIA-123" }`
- **THEN** the request `Content-Type` starts with `multipart/form-data; boundary=`
- **AND** the form has `messaging_product === "whatsapp"`, `type === "image/jpeg"` and a `file` Blob of the same byte length
- **AND** the call resolves to `{ id: "MEDIA-123" }`

#### Scenario: markAsRead is window-independent
- **GIVEN** a client with a `WindowTracker` that has never seen the recipient
- **WHEN** `client.sendText(...)` rejects with `WindowClosedError`
- **THEN** `client.markAsRead({ messageId: "wamid.X" })` still resolves to `{ success: true }`

#### Scenario: markAsRead with typing
- **WHEN** `client.markAsRead({ messageId: "wamid.X", typing: true })` is awaited
- **THEN** the posted body equals `{ messaging_product: "whatsapp", status: "read", message_id: "wamid.X", typing_indicator: { type: "text" } }`

