# agent-reply Specification

## Purpose
Turn an LLM agent's reply into WhatsApp sends that Meta accepts: split long text
without dropping characters, coerce model-written interactive replies into
valid builder input, fall back to plain text when Meta refuses an interactive,
convert Markdown to WhatsApp formatting, choose free-form vs template from the
24 h window, and detect opt-out keywords as a fallback to Meta's
`user_preferences` webhook. The SDK ships no customer-facing copy.

## Requirements

### Requirement: splitText never drops characters and respects the limit

The SDK SHALL export `splitText(text, max = 4096)` returning messages of at most `max` Unicode code points each, never splitting a surrogate pair. Joining the parts with the removed break whitespace SHALL reproduce the trimmed input. `max` that is not a positive integer SHALL throw `RangeError`.

#### Scenario: Long text splits on paragraph breaks

- **WHEN** `splitText` receives three 3000-character paragraphs joined by `\n\n`
- **THEN** it returns 3 parts, each ≤ 4096 code points, whose `\n\n` join equals the input

#### Scenario: An unbroken run is cut at exactly the limit

- **WHEN** `splitText` receives 10 000 `a` characters
- **THEN** the part lengths are `[4096, 4096, 1808]`

#### Scenario: Emoji are counted as code points

- **WHEN** `splitText` receives 5000 `😀`
- **THEN** no part exceeds 4096 code points, none contains U+FFFD, and the parts join to the input

### Requirement: splitText prefers natural breaks late in the window

Inside each `max` window `splitText` SHALL prefer, in order, a paragraph break (`\n\n`), a line break, a sentence end (`". "`), then a space, considering only breaks at or after half the window. Only an unbroken run longer than `max` SHALL be cut mid-word.

#### Scenario: A break in the first half is ignored

- **WHEN** `splitText("aa\n\nbbbbbbbbbbbb cc ddddd", 20)` is called
- **THEN** it returns `["aa\n\nbbbbbbbbbbbb cc", "ddddd"]`

#### Scenario: Words are not cut

- **WHEN** 1500 short words joined by spaces are split
- **THEN** no part starts or ends with a space and the parts joined by a space equal the input

### Requirement: Tolerant interactive builders produce strict-builder input

The SDK SHALL export `toInteractiveReply(to, reply, options?)` for `buttons` / `list` / `cta_url` replies, returning a `BuildInteractiveInput` that the existing strict builders validate. Titles, labels, header, footer and body SHALL be clipped (ending in `…`) to the limits read from `MESSAGE_LENGTH_LIMITS`; the SDK SHALL NOT duplicate those values.

#### Scenario: Excess and duplicate buttons are dropped

- **WHEN** `toInteractiveReply` receives six buttons including a duplicate id and a duplicate title, one title longer than 20 characters
- **THEN** `buildInteractive` accepts the result
- **AND** it carries 3 buttons with unique ids and titles ≤ 20 code points

#### Scenario: Lists are capped at 10 rows

- **WHEN** `toInteractiveReply` receives a list with 14 rows
- **THEN** `buildInteractive` accepts the result with 10 rows and a non-empty section title

### Requirement: Tolerant builders dedupe and cap options

`toInteractiveReply` SHALL drop options whose id or title repeats an earlier one, keep at most 3 buttons and 10 rows, default an option's id to its title, and give a list one section titled `sectionTitle` or the button label.

#### Scenario: Ids default to titles

- **WHEN** a button has no `id` and the title `Sí`
- **THEN** the built button's `reply.id` is `Sí`

#### Scenario: Nothing usable left is still refused

- **WHEN** every button title is blank
- **THEN** `buildInteractive` on the result throws a `WhatsAppError`

### Requirement: deliverReply sends one agent reply

The SDK SHALL export `deliverReply(client, to, reply, options?)` accepting any client with `sendText` and `sendInteractive` (`WhatsAppClient`, `MockWhatsAppClient`). Text SHALL be sent as `splitText` parts. An interactive body over its kind's limit SHALL first be sent as text parts, then the interactive with `options.continuationBody` (default `"…"`; no locale-specific copy in the SDK). It SHALL return `{ kind, messages, fallback?, messageIds }`.

#### Scenario: Long text becomes several messages

- **WHEN** a `text` reply of two 4000-character paragraphs and a 100-character one is delivered
- **THEN** 3 text messages are sent and their bodies join to the input

#### Scenario: Long interactive body goes first as text

- **WHEN** a `buttons` reply with a 1500-character body is delivered with `continuationBody: "¿Qué hacemos?"`
- **THEN** the full body is sent as text, then a button message whose body is `"¿Qué hacemos?"`

### Requirement: deliverReply falls back to plain text only for payload rejections

When the interactive send throws a `WhatsAppError`, `deliverReply` SHALL re-send the reply as `replyAsText` parts and set `fallback: true`, EXCEPT for `WindowClosedError`, `OptOutError`, `AuthenticationError`, `RateLimitError`, `MissingCredentialsError`, `PermissionError`, `AccountRestrictedError`, `UndeliverableError`, `TransientError`, `NetworkError`, `RequestAbortedError` and `MockModeError`, which SHALL propagate, as SHALL any non-`WhatsAppError`.

#### Scenario: Meta refuses the interactive message

- **WHEN** Meta answers the interactive send with error code `100`
- **THEN** one text message `"¿Aprobás?\n1. Aprobar\n2. Rechazar"` is sent
- **AND** the result has `kind: "text"` and `fallback: true`

#### Scenario: A closed window propagates

- **WHEN** Meta answers the interactive send with error code `131047`
- **THEN** `deliverReply` rejects with `WindowClosedError` and no text is sent

### Requirement: outboundMode decides session, template or drop

The SDK SHALL export `outboundMode({ now, lastInboundAt, optedOut, hasTemplate, marginMs? })` and `WINDOW_MARGIN_MS` (5 minutes). It SHALL return `session` when `now - lastInboundAt < WINDOW_TTL_MS - marginMs`, regardless of `optedOut`; otherwise `drop` when `optedOut` or `!hasTemplate`; otherwise `template`.

#### Scenario: Inside the margin is outside the window

- **WHEN** the last inbound message was 23 h 59 min ago and a template is available
- **THEN** `outboundMode` returns `template`

#### Scenario: Opted out outside the window

- **WHEN** the last inbound message was 48 h ago and `optedOut` is true
- **THEN** `outboundMode` returns `drop`

### Requirement: detectOptOut recognises short typed opt-outs without copy

The SDK SHALL export `detectOptOut(text)` returning `"es"`, `"en"` or `null`. Text SHALL be normalized (NFD, accents removed, lower case, punctuation to spaces); normalized text longer than 80 characters SHALL return `null`. The SDK SHALL NOT ship acknowledgement copy. Documentation SHALL state that Meta's `user_preferences` webhook and error `131050` stay authoritative for marketing opt-out.

#### Scenario: Spanish and English requests

- **WHEN** `detectOptOut` receives `"No me escriban más"` or `"Baja!"`
- **THEN** it returns `"es"`
- **AND** for `"please stop messaging me"` it returns `"en"`

#### Scenario: Ordinary or long messages

- **WHEN** `detectOptOut` receives `"baja de ventas en la app"` or a 100-character story containing "no me escriban"
- **THEN** it returns `null`
