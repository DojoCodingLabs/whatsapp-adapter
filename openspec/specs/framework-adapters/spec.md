# framework-adapters Specification

## Purpose
TBD - created by archiving change add-framework-adapters-express. Update Purpose after archive.
## Requirements
### Requirement: createWhatsAppMiddleware returns an Express RequestHandler
The package SHALL export `createWhatsAppMiddleware(receiver, options?)` from `@dojocoding/whatsapp/express`. The return value SHALL be an Express `RequestHandler` (or `Router`) suitable for mounting via `app.use(path, mw)`. It SHALL handle `GET` (verify-token handshake) and `POST` (event receiver) on the mount path. Other verbs SHALL receive `405 Method Not Allowed`.

#### Scenario: GET with a valid handshake echoes the challenge
- **WHEN** `GET /webhook?hub.mode=subscribe&hub.verify_token=ok&hub.challenge=1234` is sent
- **AND** the receiver is constructed with `verifyToken: "ok"`
- **THEN** the response is `200` with body `"1234"` (text/plain)

#### Scenario: GET with a wrong verify token returns 403
- **WHEN** `GET /webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234` is sent
- **THEN** the response is `403`

#### Scenario: POST with a valid signature dispatches handlers and acks 200
- **WHEN** the consumer registers `.on("message", h)`, the request body is a captured Meta payload, and the `X-Hub-Signature-256` header is correctly computed
- **THEN** the response is `200` (within milliseconds, not waiting for the handler)
- **AND** `h` is invoked exactly once with the parsed message event

#### Scenario: POST with a tampered body returns 401
- **WHEN** the body is altered after the signature was computed
- **THEN** the response is `401`
- **AND** no registered handler is invoked

#### Scenario: PUT / DELETE return 405
- **WHEN** any verb other than `GET` or `POST` is sent to the mount path
- **THEN** the response is `405`

### Requirement: Raw body is captured BEFORE any JSON parser
The middleware SHALL apply `express.raw({ type: "application/json" })` internally so the raw bytes are available for HMAC verification. The middleware SHALL NOT depend on consumers having pre-installed `express.json()` (and indeed must not, since `express.json()` would consume the stream).

#### Scenario: Mounting before express.json works
- **WHEN** `app.use("/webhook", createWhatsAppMiddleware(receiver))` is registered before `app.use(express.json())`, and a signed POST arrives
- **THEN** the middleware reads the raw body and verifies; the response is 200

#### Scenario: Mounting after express.json still works (raw is captured locally)
- **WHEN** `app.use(express.json())` is registered globally before `app.use("/webhook", createWhatsAppMiddleware(receiver))`
- **THEN** the middleware's internal `express.raw({ type: "application/json" })` re-captures the body for the matched route since Express only consumes the body once per request — but for routes that haven't already been parsed, the raw layer here is the only consumer

NOTE: as a practical matter, consumers SHOULD register the WhatsApp middleware before any global JSON parser. The internal raw layer makes the safe path the easy path; consumers who break the rule will see their POSTs end with empty bodies and 401s.

### Requirement: 200 ack landed within milliseconds; handlers run async
Upon receiving a verified POST, the middleware SHALL respond `200` BEFORE awaiting `dispatchPromise`. Handlers may take seconds and SHALL NOT delay the ack. Consumers can opt into observing handler errors via `options.onUnhandledHandlerError(err)` (defaults to `console.error`).

#### Scenario: A slow handler does not block the ack
- **WHEN** a `message` handler is registered that resolves after 100 ms
- **AND** a signed POST is sent
- **THEN** the response is `200` within 50 ms (well below 100 ms)

#### Scenario: A handler error fires onUnhandledHandlerError
- **WHEN** `options.onUnhandledHandlerError` is provided and a handler throws
- **THEN** the response is still `200` (already sent)
- **AND** `onUnhandledHandlerError` is called with the thrown error

