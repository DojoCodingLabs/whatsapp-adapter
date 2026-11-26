## ADDED Requirements

### Requirement: Builders accept exactly one of to or recipient

Every builder input SHALL accept exactly one of `to` (phone number / `wa_id`) or `recipient` (BSUID or parent BSUID: ISO alpha-2 country code, `.`, optional `ENT.`, 1–128 alphanumerics), and the payload SHALL carry only the supplied field. Both or neither, a malformed BSUID, or a BSUID-shaped `to` SHALL throw `WhatsAppError("UNKNOWN")` before any HTTP call, without echoing the value. The SDK SHALL export `isBsuid`, `BSUID_PATTERN` and `recipientKeyOf`.

#### Scenario: BSUID text send uses the recipient field

- **WHEN** `buildText({ recipient: "US.13491208655302741918", body: "hi" })` is called
- **THEN** the payload has `recipient: "US.13491208655302741918"` and no `to`

#### Scenario: Both addresses rejected

- **WHEN** a builder is called with both `to` and `recipient`
- **THEN** it throws `WhatsAppError` with `code === "UNKNOWN"`

### Requirement: Authentication templates are phone-number only

`buildAuthTemplate` SHALL reject a `recipient` (BSUID) with `TemplateError`, because Meta requires user phone numbers for one-tap, zero-tap and copy-code templates (code 131062).

#### Scenario: Auth template rejects a BSUID

- **WHEN** `buildAuthTemplate({ recipient: "US.1", name, language, otp })` is called
- **THEN** it throws `TemplateError` mentioning 131062

### Requirement: Reactions are never contextual replies

`buildReaction` SHALL reject a `replyTo` value with `WhatsAppError("UNKNOWN")` and SHALL never emit `context`. `sendReply` SHALL reject a payload whose `type` is `"reaction"` before any HTTP call.

#### Scenario: Reaction with replyTo rejected

- **WHEN** `buildReaction({ to, messageId, emoji, replyTo: "wamid.y" })` is called
- **THEN** it throws `WhatsAppError` with `code === "UNKNOWN"`

#### Scenario: sendReply refuses a reaction payload

- **WHEN** `client.sendReply("wamid.x", reactionPayload)` is called with an open window
- **THEN** it rejects with `WhatsAppError("UNKNOWN")`
- **AND** no HTTP request is issued

### Requirement: List body limit and https-only cta_url

`MESSAGE_LENGTH_LIMITS.listBody` SHALL be 4096, and `buildInteractiveList` SHALL apply it to `body`. Reply-button and cta_url bodies SHALL keep the 1024 limit. `buildInteractiveCtaUrl` SHALL reject a `cta.url` whose scheme is not `https:`.

#### Scenario: 4096-character list body accepted

- **WHEN** `buildInteractiveList` is called with a 4096-character body
- **THEN** it returns a payload
- **AND** a 4097-character body throws naming the 4096 maximum

#### Scenario: javascript: cta URL rejected

- **WHEN** `buildInteractiveCtaUrl` is called with `cta.url = "javascript:alert(1)"`
- **THEN** it throws `WhatsAppError("UNKNOWN")`
