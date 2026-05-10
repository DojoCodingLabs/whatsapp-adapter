## ADDED Requirements

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
