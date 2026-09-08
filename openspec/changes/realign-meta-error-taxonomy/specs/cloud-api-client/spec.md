## MODIFIED Requirements

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

#### Scenario: `classifyRetryReason` returns `"rate_limit"` for 429 and 130429

- **WHEN** `classifyRetryReason(new TransientHttpError("...", undefined, 429))` is called
- **THEN** the return value SHALL be `"rate_limit"`
- **AND** when `classifyRetryReason(new RateLimitError("...", { metaCode: 130429 }))` is called
- **THEN** the return value SHALL ALSO be `"rate_limit"`

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
