## ADDED Requirements

### Requirement: Discriminated-union message types
The package SHALL export a `WhatsAppMessage` TypeScript discriminated union covering every Cloud API send-able body. Discriminator: top-level `type` field. Variants: `"text"`, `"image"`, `"video"`, `"audio"`, `"document"`, `"sticker"`, `"location"`, `"contacts"`, `"interactive"`, `"template"`, `"reaction"`. Every variant SHALL include the literal `messaging_product: "whatsapp"` and a typed `to` field.

#### Scenario: TypeScript narrows the union by `type`
- **WHEN** a consumer writes `if (msg.type === "text") { msg.text.body }` against a value typed as `WhatsAppMessage`
- **THEN** the TypeScript compiler accepts `msg.text.body` as a `string`
- **AND** the same access against the union (without narrowing) is a compile error

### Requirement: Per-type builder functions
The package SHALL export a builder function per supported variant: `buildText`, `buildImage`, `buildVideo`, `buildAudio`, `buildDocument`, `buildSticker`, `buildLocation`, `buildContacts`, `buildInteractiveButton`, `buildInteractiveList`, `buildInteractiveCtaUrl`, `buildTemplate`, `buildReaction`. Each builder SHALL:
1. Accept a typed input shape with `to: string` and the variant-specific fields.
2. Validate the input via a zod schema (also exported from the package).
3. Return the wire payload object — no I/O.
4. Reject invalid input with a `TemplateError` (when input came from a template path) or `WhatsAppError("UNKNOWN", …)` carrying the zod issues.

#### Scenario: `buildText` produces the documented wire shape
- **WHEN** `buildText({ to: "521234567890", body: "hi" })` is called
- **THEN** the returned object equals `{ messaging_product: "whatsapp", recipient_type: "individual", to: "521234567890", type: "text", text: { body: "hi" } }`

#### Scenario: `buildText` accepts an optional `previewUrl` and emits `text.preview_url`
- **WHEN** `buildText({ to: "X", body: "https://example", previewUrl: true })` is called
- **THEN** the returned `text` field is `{ body: "https://example", preview_url: true }`

#### Scenario: Empty `to` is rejected with a clear error
- **WHEN** `buildText({ to: "", body: "hi" })` is called
- **THEN** the call throws a `WhatsAppError`
- **AND** the message contains "to" or "recipient"

#### Scenario: `buildImage` accepts `id` OR `link`, rejects both/neither
- **WHEN** `buildImage({ to: "X", link: "https://…/cat.png", caption: "cat" })` is called
- **THEN** the returned `image` is `{ link: "https://…/cat.png", caption: "cat" }`
- **WHEN** `buildImage({ to: "X" })` is called (neither `id` nor `link`)
- **THEN** the call throws a `WhatsAppError`

#### Scenario: `buildLocation` requires latitude and longitude in valid ranges
- **WHEN** `buildLocation({ to: "X", latitude: 19.4326, longitude: -99.1332 })` is called
- **THEN** the returned `location` is `{ latitude: 19.4326, longitude: -99.1332 }`
- **WHEN** `buildLocation({ to: "X", latitude: 91, longitude: 0 })` is called (out of range)
- **THEN** the call throws a `WhatsAppError`

#### Scenario: `buildInteractiveButton` enforces 1–3 reply buttons
- **WHEN** `buildInteractiveButton({ to: "X", body: "Pick one", buttons: [{ id: "a", title: "A" }, { id: "b", title: "B" }] })`
- **THEN** the returned payload's `interactive.action.buttons` is an array of two `{ type: "reply", reply: { id, title } }` entries
- **WHEN** the same call is made with 4 buttons
- **THEN** the call throws a `WhatsAppError`

#### Scenario: `buildInteractiveList` enforces 1–10 sections, each with 1–10 rows
- **WHEN** `buildInteractiveList({ to, body, button, sections: [{ title, rows: [{ id, title }] }] })` is valid input
- **THEN** the payload mirrors the input
- **WHEN** a section is empty (`rows: []`)
- **THEN** the call throws a `WhatsAppError`

#### Scenario: `buildTemplate` requires the placeholder count to match supplied parameters per component
- **WHEN** `buildTemplate({ to, name: "order_status", language: "en_US", body: { params: ["A1", "B2"] } })` is called and the template is built around two `{{1}}`/`{{2}}` placeholders supplied by the caller
- **THEN** the payload includes `template.components[].parameters` of length 2
- **WHEN** the caller passes 1 parameter
- **THEN** the call throws a `TemplateError` with a message naming the mismatch

#### Scenario: `buildReaction` accepts an empty `emoji` to clear a reaction
- **WHEN** `buildReaction({ to: "X", messageId: "wamid.xyz", emoji: "" })` is called
- **THEN** the returned payload's `reaction.emoji` is `""`
- **AND** `reaction.message_id === "wamid.xyz"`

### Requirement: Reply variant — top-level `context.message_id`
Every builder SHALL accept an optional `replyTo: string` parameter. When present, the returned payload SHALL include a top-level `context: { message_id: <replyTo> }` field, in addition to the variant body. The `replyTo` value SHALL be a non-empty string; empty values are rejected.

#### Scenario: Reply to a prior message is reflected at the top level
- **WHEN** `buildText({ to: "X", body: "ack", replyTo: "wamid.abc" })`
- **THEN** the payload includes `context: { message_id: "wamid.abc" }` at the top level (NOT inside `text`)

#### Scenario: Empty `replyTo` is rejected
- **WHEN** `buildText({ to: "X", body: "ack", replyTo: "" })`
- **THEN** the call throws a `WhatsAppError`

### Requirement: `sendMessage(client, payload)` posts to `/{phoneNumberId}/messages`
The package SHALL export a `sendMessage(client: WhatsAppClient, payload: WhatsAppMessage): Promise<MessageSendResponse>` helper that POSTs the payload to the path `/${client.phoneNumberId}/messages` via `client.request()`. The response SHALL be parsed into the typed shape `{ messaging_product: "whatsapp"; contacts: ReadonlyArray<{ input: string; wa_id: string }>; messages: ReadonlyArray<{ id: string }> }`.

#### Scenario: Successful send returns wamid
- **WHEN** the underlying request succeeds with `{ messaging_product: "whatsapp", contacts: [{ input: "X", wa_id: "X" }], messages: [{ id: "wamid.123" }] }`
- **THEN** `sendMessage()` resolves with that exact shape
- **AND** the request was POSTed to `/${phoneNumberId}/messages`

### Requirement: Convenience send methods on `WhatsAppClient`
`WhatsAppClient` SHALL expose one convenience method per builder, each taking the same input as its builder and returning the `MessageSendResponse`. Methods: `sendText`, `sendImage`, `sendVideo`, `sendAudio`, `sendDocument`, `sendSticker`, `sendLocation`, `sendContacts`, `sendInteractive`, `sendTemplate`, `sendReaction`, `sendReply` (which dispatches based on the wrapped `payload.type`).

#### Scenario: `client.sendText(input)` round-trips like `sendMessage(client, buildText(input))`
- **WHEN** `client.sendText({ to: "X", body: "hi" })` is called
- **THEN** a single POST is issued to `/${phoneNumberId}/messages`
- **AND** the wire body is byte-equivalent to `JSON.stringify(buildText({ to: "X", body: "hi" }))`

#### Scenario: `client.sendInteractive` dispatches by `kind` discriminator
- **WHEN** `client.sendInteractive({ to: "X", kind: "button", body: "Pick", buttons: [{id:"a",title:"A"}] })` is called
- **THEN** the wire payload's `interactive.type` is `"button"`

#### Scenario: Validator failure rejects before any HTTP call
- **WHEN** `client.sendText({ to: "", body: "hi" })` is called
- **THEN** a `WhatsAppError` is thrown synchronously (or on the first promise microtask) without an outbound `fetch`
