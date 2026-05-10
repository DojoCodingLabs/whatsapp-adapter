# Messages (`message-builders`)

Typed wire-payload builders for every send-able WhatsApp message, plus the
`WhatsAppMessage` discriminated union that consumer code can pattern-match
on.

Spec: [`openspec/specs/message-builders/spec.md`](../openspec/specs/message-builders/spec.md).
Source: [`src/messages/`](../src/messages/).

## The discriminated union

```ts
export type WhatsAppMessage =
  | TextMessage
  | ImageMessage
  | VideoMessage
  | AudioMessage
  | DocumentMessage
  | StickerMessage
  | LocationMessage
  | ContactsMessage
  | InteractiveMessage
  | TemplateMessage
  | ReactionMessage;
```

Every variant carries `messaging_product: "whatsapp"`, `recipient_type:
"individual"`, and a top-level `to`. The `type` field is the
discriminator. TypeScript narrows on it:

```ts
function describe(msg: WhatsAppMessage) {
  if (msg.type === "text") return msg.text.body; // ✓ narrows
  if (msg.type === "interactive") return msg.interactive; // ✓ narrows
  // …
}
```

## Public exports

```ts
import {
  // Builders
  buildText,
  buildImage,
  buildVideo,
  buildAudio,
  buildDocument,
  buildSticker,
  buildLocation,
  buildContacts,
  buildInteractive, // dispatches by `kind`
  buildInteractiveButton, // direct
  buildInteractiveList, // direct
  buildInteractiveCtaUrl, // direct
  buildTemplate,
  buildReaction,
  // Helper
  sendMessage,
  // Builder input types
  type BuildTextInput,
  type BuildMediaInput,
  type BuildLocationInput,
  type BuildContactsInput,
  type BuildInteractiveInput,
  type BuildInteractiveButtonInput,
  type BuildInteractiveListInput,
  type BuildInteractiveCtaUrlInput,
  type BuildTemplateInput,
  type BuildReactionInput,
  // Wire payload types
  type WhatsAppMessage,
  type TextMessage,
  type ImageMessage,
  // … (one per variant)
  type MessageSendResponse,
} from "@dojocoding/whatsapp";
```

## Why builders, not classes

Builders return plain objects matching Meta's wire format. You can:

- Inspect them in tests (`expect(payload).toEqual({...})`).
- Persist them to a queue / outbox.
- Replay them through `sendMessage(client, payload)` later.
- Use them with the mock client without re-wiring anything.

There's no hidden state in a built payload. Compare against class-based
SDKs where `new Text("hi")` produces an object that knows how to send
itself — useful in some workflows, harder to introspect.

## The eleven outbound types

### Text

```ts
buildText({ to: "521234567890", body: "Hello" });
// {
//   messaging_product: "whatsapp",
//   recipient_type: "individual",
//   to: "521234567890",
//   type: "text",
//   text: { body: "Hello" }
// }
```

`previewUrl: true` opts in to URL previews. `body` must be non-empty.

### Media (image, video, audio, document, sticker)

Pass exactly one of `id` (a previously-uploaded media id from
`POST /{phoneNumberId}/media`) or `link` (a public URL Meta will fetch on
your behalf). Both or neither throws.

```ts
buildImage({ to, link: "https://example.com/cat.png", caption: "cat" });
buildDocument({ to, id: "uploaded-media-id", filename: "invoice.pdf" });
buildAudio({ to, link: "https://example.com/clip.ogg" });
```

`caption` and `filename` apply only to types that accept them — see the
type signatures (audio / sticker take only `id` / `link`).

### Location

```ts
buildLocation({
  to,
  latitude: 19.4326,
  longitude: -99.1332,
  name: "Mexico City",
  address: "Centro Histórico",
});
```

`latitude` must be in `[-90, 90]`; `longitude` in `[-180, 180]`. Out of
range throws `WhatsAppError("UNKNOWN", …)`.

### Contacts

```ts
buildContacts({
  to,
  contacts: {
    name: { formatted_name: "Daniel Bejarano" },
    phones: [{ phone: "+50612345678", type: "CELL" }],
    emails: [{ email: "dani@example.com", type: "WORK" }],
  },
});
```

`name.formatted_name` is required on every contact. You may pass a single
contact or an array.

### Interactive

Three sub-types via the `kind` discriminator:

```ts
// Reply buttons (1–3)
buildInteractive({
  kind: "button",
  to,
  body: "Pick one",
  buttons: [
    { id: "yes", title: "Yes" },
    { id: "no", title: "No" },
  ],
});

// List menu (1–10 sections, each 1–10 rows)
buildInteractive({
  kind: "list",
  to,
  body: "Choose a tour",
  button: "View tours",
  sections: [
    {
      title: "This week",
      rows: [
        { id: "tour-1", title: "Cloud Forest", description: "Half day" },
        { id: "tour-2", title: "Rainforest", description: "Full day" },
      ],
    },
  ],
});

// CTA URL (opens a URL on tap)
buildInteractive({
  kind: "cta_url",
  to,
  body: "Book your spot",
  cta: { displayText: "Book now", url: "https://horizontes.com/book" },
});
```

Headers and footers are optional and per-sub-type. List headers are
text-only; button / cta_url headers can be text, image, video, or
document.

### Template

```ts
buildTemplate({
  to,
  name: "appointment_reminder",
  language: "en_US",
  components: [
    {
      type: "body",
      parameters: [
        { type: "text", text: "Daniel" },
        { type: "date_time", date_time: { fallback_value: "Tue 10am" } },
      ],
    },
  ],
});
```

Templates are the escape hatch when the 24-hour window is closed.

**Pre-flight validation** (recommended for production use):

```ts
const definition = await client.getTemplate(templateId);
buildTemplate({
  to,
  name,
  language,
  components,
  validateAgainst: definition, // throws TemplateError on mismatch
});
```

This catches param-count and component-shape mismatches _before_ the HTTP
call. See [`templates.md`](./templates.md).

### Reaction

```ts
buildReaction({ to, messageId: "wamid.HBg…", emoji: "👍" });
buildReaction({ to, messageId: "wamid.HBg…", emoji: "" }); // clears a previous reaction
```

Empty `emoji` is intentional and clears a prior reaction.

## Replying to a previous message

Every builder accepts `replyTo: <wamid>`. The wamid lands at the top
level as `context.message_id` (NOT inside the variant body):

```ts
buildText({ to, body: "thanks!", replyTo: "wamid.HBg..." });
// {
//   messaging_product, recipient_type, to,
//   type: "text",
//   text: { body: "thanks!" },
//   context: { message_id: "wamid.HBg..." }
// }
```

Empty `replyTo` throws.

The convenience `client.sendReply(replyTo, payload)` wraps any pre-built
`WhatsAppMessage` with the same `context.message_id`:

```ts
const payload = buildImage({ to, link: "https://…/map.png" });
await client.sendReply("wamid.HBg…", payload);
```

`sendReply` window-gates non-template, non-reaction payloads. Templates
and reactions remain window-exempt even when sent as replies.

## `sendMessage(client, payload)`

The single low-level helper that POSTs a built `WhatsAppMessage`:

```ts
import { sendMessage, buildText } from "@dojocoding/whatsapp";

const payload = buildText({ to, body: "Hi" });
const res = await sendMessage(client, payload);
console.log(res.messages[0].id); // wamid
```

`client.sendText(input)` is exactly equivalent to
`sendMessage(client, buildText(input))` plus the window pre-flight.

## Validation rules (all enforced at build time)

| Rule                                                               | Builder                  | Error                         |
| ------------------------------------------------------------------ | ------------------------ | ----------------------------- |
| `to` is a non-empty string                                         | all                      | `WhatsAppError("UNKNOWN", …)` |
| `replyTo` is a non-empty string when present                       | all                      | `WhatsAppError("UNKNOWN", …)` |
| Exactly one of `id` / `link`                                       | media builders           | `WhatsAppError("UNKNOWN", …)` |
| `latitude` ∈ `[-90, 90]`, `longitude` ∈ `[-180, 180]`              | `buildLocation`          | `WhatsAppError("UNKNOWN", …)` |
| Every contact has `name.formatted_name`                            | `buildContacts`          | `WhatsAppError("UNKNOWN", …)` |
| 1–3 reply buttons, each with non-empty `id` and `title`            | `buildInteractiveButton` | `WhatsAppError("UNKNOWN", …)` |
| 1–10 sections, each with 1–10 rows; row `id` and `title` non-empty | `buildInteractiveList`   | `WhatsAppError("UNKNOWN", …)` |
| `cta.displayText` non-empty; `cta.url` parses as URL               | `buildInteractiveCtaUrl` | `WhatsAppError("UNKNOWN", …)` |
| Template `name` and `language` non-empty                           | `buildTemplate`          | `TemplateError`               |
| Template button components have a `sub_type`                       | `buildTemplate`          | `TemplateError`               |
| Reaction `messageId` non-empty; `emoji` is a string                | `buildReaction`          | `WhatsAppError("UNKNOWN", …)` |

The builder throws synchronously / on the first promise microtask **before**
any HTTP call. This means you'll never see a network round-trip from a
malformed builder input.

## Gotchas

- **`previewUrl` is only on text.** It's `text.preview_url` on the wire,
  not a top-level field.
- **Reaction `emoji: ""` clears a reaction** — that's a Meta convention,
  not a typo to defend against.
- **Document `filename` is a hint, not a rename.** Meta uses it as the
  download filename in the recipient's WhatsApp app.
- **Sticker / audio do not accept `caption` or `filename`.** The types
  enforce this; if you assemble a payload by hand, don't add them.
- **Interactive list sections are 1–10 / 1–10.** A list with zero rows
  in any section throws.
- **`buildInteractive({ kind: "..." })` exhausts** — passing an unknown
  `kind` is a TypeScript error and a runtime throw.
