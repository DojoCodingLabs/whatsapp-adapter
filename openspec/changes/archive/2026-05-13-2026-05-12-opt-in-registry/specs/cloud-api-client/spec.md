## MODIFIED Requirements

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
