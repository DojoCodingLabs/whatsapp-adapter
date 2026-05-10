## ADDED Requirements

### Requirement: Every webhook handler invocation emits an OTel span
`WebhookReceiver._dispatch` SHALL wrap each handler invocation in a `withSpan("whatsapp.webhook.dispatch", …)`. The span SHALL carry attributes:
- `whatsapp.event.kind` — the event's `kind` (`message`, `status`, `template_status`, etc.)
- `whatsapp.waba_id` — hashed
- `whatsapp.phone_number_id` — hashed (if present on the event)
- `whatsapp.event.id` — for `message`/`status` events only; the `wamid` (NOT hashed — it is not PII)

When the handler throws, the span SHALL be recorded with `SpanStatusCode.ERROR` and the exception event attached.

#### Scenario: A registered message handler is invoked under a span
- **WHEN** a test handler runs to completion via `receiver.handlePayload(...)`
- **THEN** the exporter records exactly one `whatsapp.webhook.dispatch` span per handler invocation
- **AND** the span's `attributes["whatsapp.event.kind"] === "message"`

#### Scenario: A throwing handler records ERROR status on its span
- **WHEN** a registered `message` handler throws
- **THEN** the dispatch span for that invocation has `status.code === SpanStatusCode.ERROR`
- **AND** the span includes an `exception` event whose attribute `exception.message` matches the thrown error
