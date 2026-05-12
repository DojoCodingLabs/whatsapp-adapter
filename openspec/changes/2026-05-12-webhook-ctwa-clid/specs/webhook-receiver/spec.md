## MODIFIED Requirements

### Requirement: Parsed message-event surface

The webhook parser SHALL emit a `MessageEvent` for every entry
in `entry[i].changes[i].value.messages[i]` of the incoming
payload, preserving the documented fields (`id`, `from`,
`timestamp`, `type`, type-specific body, `context` for replies)
and, **when present in the payload**, the `referral` object
verbatim.

The `referral` field SHALL be typed as
`WhatsAppReferral & Record<string, unknown>` so:

- TypeScript narrows the documented core fields (`ctwa_clid`,
  `source_url`, `source_type`, `source_id`, `headline`, `body`,
  `media_type`, `media_url`, `thumbnail_url`, `welcome_message`).
- Unknown additional fields Meta may introduce in the future
  are preserved at runtime without requiring an SDK release.

When `messages[i].referral` is absent, `event.referral` SHALL
be `undefined`. When `messages[i].referral` is an empty object,
`event.referral` SHALL be `{}` (preserved). The parser SHALL
NOT throw on unrecognised `referral` shapes.

#### Scenario: CTWA-tagged inbound message exposes `ctwa_clid`

- **GIVEN** an incoming webhook payload where `messages[0].referral.ctwa_clid` is `"ARZxq..."`
- **WHEN** `parseWebhookPayload(...)` is called
- **THEN** the emitted `MessageEvent.referral.ctwa_clid` SHALL be `"ARZxq..."`
- **AND** every other documented field of `referral` SHALL be preserved byte-identically

#### Scenario: Empty `referral` object is preserved

- **GIVEN** an incoming webhook payload where `messages[0].referral` is `{}`
- **WHEN** the payload is parsed
- **THEN** `event.referral` SHALL be `{}` (NOT `undefined`)

#### Scenario: Message without `referral` produces undefined

- **GIVEN** an incoming webhook payload where `messages[0]` has no `referral` key
- **WHEN** the payload is parsed
- **THEN** `event.referral` SHALL be `undefined`

#### Scenario: Unknown extra fields inside `referral` are preserved

- **GIVEN** an incoming webhook payload where `messages[0].referral` contains a field Meta added after this SDK release (e.g. `referral.future_field: "x"`)
- **WHEN** the payload is parsed
- **THEN** `event.referral.future_field` at runtime SHALL be `"x"`
- **AND** the parser SHALL NOT throw
