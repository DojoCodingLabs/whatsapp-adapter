## ADDED Requirements

### Requirement: Builders pre-flight Meta's documented character limits
The package SHALL export `MESSAGE_LENGTH_LIMITS` with the values `textBody: 4096`, `mediaCaption: 1024`, `interactiveBody: 1024`, `interactiveFooter: 60`, `interactiveHeaderText: 60`, `replyButtonTitle: 20`, `replyButtonId: 256`, `listButton: 20`, `listSectionTitle: 24`, `listRowTitle: 24`, `listRowDescription: 72`, `listRowId: 200`, `ctaUrlDisplayText: 20`.

`buildText` SHALL reject `body` longer than `textBody`. `buildImage`, `buildVideo` and `buildDocument` SHALL reject `caption` longer than `mediaCaption`. `buildInteractiveButton`, `buildInteractiveList` and `buildInteractiveCtaUrl` SHALL reject `body`, `footer` and a `type: "text"` header longer than their respective limits, and additionally: reply-button `title` / `id`; list `button`, section `title`, row `id` / `title` / `description`; `cta.displayText`. Length SHALL be measured in Unicode code points. Rejection SHALL be a `WhatsAppError("UNKNOWN")` thrown before the payload is returned whose message names the field (with array index where applicable) and the limit. Values exactly at the limit SHALL be accepted.

#### Scenario: Text body over 4096 characters is rejected locally
- **WHEN** `buildText({ to, body: "x".repeat(4097) })` is called
- **THEN** it throws a `WhatsAppError` with `code === "UNKNOWN"` whose message contains `body` and `4096-character maximum`

#### Scenario: Text body of exactly 4096 characters is accepted
- **WHEN** `buildText({ to, body: "x".repeat(4096) })` is called
- **THEN** the returned `text.body` has 4096 characters

#### Scenario: Code points, not UTF-16 units
- **WHEN** `buildText({ to, body: "😀".repeat(4096) })` is called (8192 UTF-16 units, 4096 characters)
- **THEN** the call does not throw

#### Scenario: Reply-button title over 20 characters names the button index
- **WHEN** `buildInteractiveButton({ to, body, buttons: [{ id: "a", title: "ok" }, { id: "b", title: "x".repeat(21) }] })` is called
- **THEN** it throws a `WhatsAppError` whose message contains `buttons[1].title` and `20-character maximum`

#### Scenario: List row description over 72 characters names the section and row
- **WHEN** a list is built with `sections[0].rows[0].description` of 73 characters
- **THEN** it throws a `WhatsAppError` whose message contains `sections[0].rows[0].description` and `72-character maximum`

#### Scenario: Media header on an interactive message is not length-checked
- **WHEN** `buildInteractiveButton({ to, body, buttons, header: { type: "image", image: { link } } })` is called
- **THEN** no length error is raised for the header

#### Scenario: cta_url display text over 20 characters
- **WHEN** `buildInteractiveCtaUrl({ to, body, cta: { displayText: "x".repeat(21), url } })` is called
- **THEN** it throws a `WhatsAppError` whose message contains `cta.displayText` and `20-character maximum`
