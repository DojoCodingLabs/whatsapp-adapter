## ADDED Requirements

### Requirement: Typed error hierarchy with discriminator codes
The package SHALL export a base `WhatsAppError` class extending the built-in `Error`, plus the following subclasses, each with a unique `readonly code` discriminator string: `MissingCredentialsError` (`"MISSING_CREDENTIALS"`), `RateLimitError` (`"RATE_LIMIT"`), `WindowClosedError` (`"WINDOW_CLOSED"`), `WebhookSignatureError` (`"WEBHOOK_SIGNATURE"`), `TemplateError` (`"TEMPLATE"`), `MockModeError` (`"MOCK_MODE"`).

The base class SHALL set the prototype chain correctly so that `instanceof` checks work across module boundaries (`Object.setPrototypeOf(this, new.target.prototype)`). Every subclass instance SHALL be both `instanceof <Subclass>` and `instanceof WhatsAppError`.

#### Scenario: Subclass instanceof base class
- **WHEN** a `WebhookSignatureError` is thrown and caught
- **THEN** `error instanceof WebhookSignatureError === true`
- **AND** `error instanceof WhatsAppError === true`
- **AND** `error instanceof Error === true`

#### Scenario: Discriminator code is set
- **WHEN** any subclass is constructed
- **THEN** `error.code` equals the subclass's documented discriminator string
- **AND** `error.code` is `readonly` (TypeScript strict reports an error on reassignment)

#### Scenario: Errors serialize without leaking sensitive context
- **WHEN** a `WhatsAppError` instance is `JSON.stringify`'d
- **THEN** the output contains `name`, `code`, and `message` fields
- **AND** the output SHALL NOT include any `token`, `appSecret`, or raw webhook body fields

### Requirement: Webhook ack deadline exposed as a constant
The package SHALL export a `WEBHOOK_ACK_DEADLINE_MS` constant set to `30_000` (30 seconds) so that the receiver implementation in Phase 3 and any consumer middleware can refer to a single source of truth for the deadline within which Meta expects a 200 response.

#### Scenario: Constant value
- **WHEN** the consumer imports `WEBHOOK_ACK_DEADLINE_MS`
- **THEN** the value is exactly `30000`

### Requirement: Customer-service-window TTL exposed as a constant
The package SHALL export a `WINDOW_TTL_MS` constant set to `86_400_000` (24 hours in milliseconds), to be consumed by the `WindowTracker` capability in Phase 4.

#### Scenario: Constant value
- **WHEN** the consumer imports `WINDOW_TTL_MS`
- **THEN** the value is exactly `24 * 60 * 60 * 1000`
