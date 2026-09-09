## MODIFIED Requirements

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
