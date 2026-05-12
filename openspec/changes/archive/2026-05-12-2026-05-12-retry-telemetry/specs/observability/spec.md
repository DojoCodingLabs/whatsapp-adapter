## MODIFIED Requirements

### Requirement: withSpan async wrapper

The `withSpan(name, fn, attributes)` helper SHALL wrap an
async function in an OpenTelemetry span with the given name
and initial attributes. On success the span SHALL be ended
with `SpanStatusCode.OK`; on a thrown error the span SHALL be
ended with `SpanStatusCode.ERROR` and the error attached via
`span.recordException(err)` followed by the propagating throw.

The active span SHALL be settable via additional attributes
inside `fn` (`trace.getActiveSpan()?.setAttribute(...)`); this
is the mechanism by which `whatsapp.request` and
`whatsapp.webhook.dispatch` accumulate retry, error, and
event-kind attributes after the span is opened.

For the `whatsapp.request` span specifically, the transport
layer SHALL attach the following retry-summary attributes
after the retry helper completes (both success and final
failure paths):

- **`whatsapp.retry.count`** (number) — count of retry
  attempts AFTER the first call. `0` when the first attempt
  succeeded without retry. ALWAYS present on every
  `whatsapp.request` span.
- **`whatsapp.retry.reason`** (string, one of
  `"transient_http" | "rate_limit" | "network" | "abort"`) —
  the classification of the MOST RECENT retry. Present
  ONLY when `whatsapp.retry.count > 0`. Absent when no
  retries occurred (so dashboards can filter "no-retry"
  vs "retried" cleanly).

#### Scenario: First-attempt success has whatsapp.retry.count = 0

- **GIVEN** a `WhatsAppClient.sendText(...)` call where Meta returns 200 on the first attempt
- **WHEN** the `whatsapp.request` span ends
- **THEN** the span SHALL have attribute `whatsapp.retry.count = 0`
- **AND** the span SHALL NOT have a `whatsapp.retry.reason` attribute

#### Scenario: Two 503 retries then success records count=2 and reason="transient_http"

- **GIVEN** a `WhatsAppClient.sendText(...)` call where Meta returns 503 twice and 200 on the third attempt
- **WHEN** the `whatsapp.request` span ends
- **THEN** the span SHALL have `whatsapp.retry.count = 2`
- **AND** the span SHALL have `whatsapp.retry.reason = "transient_http"`

#### Scenario: A 429 retry records reason="rate_limit"

- **GIVEN** a `WhatsAppClient.sendText(...)` call where Meta returns 429 then 200
- **WHEN** the span ends
- **THEN** `whatsapp.retry.count = 1`
- **AND** `whatsapp.retry.reason = "rate_limit"`

#### Scenario: A Meta business rate-limit (code 130429) retry records reason="rate_limit"

- **GIVEN** Meta returns a 400 with body `{ error: { code: 130429, ... } }` then 200
- **WHEN** the span ends
- **THEN** `whatsapp.retry.count = 1`
- **AND** `whatsapp.retry.reason = "rate_limit"`

#### Scenario: Final-failure path also records retry attributes

- **GIVEN** a `WhatsAppClient.sendText(...)` call where Meta returns 503 on every attempt and the retry helper exhausts `maxAttempts`
- **WHEN** the call throws and the `whatsapp.request` span ends with status ERROR
- **THEN** the span SHALL ALSO have `whatsapp.retry.count = (maxAttempts - 1)`
- **AND** `whatsapp.retry.reason = "transient_http"`
- **AND** the existing `whatsapp.error.code` attribute SHALL also be present
