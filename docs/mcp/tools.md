# Tools

The MCP server registers 16 tools. Every tool name is
`snake_case` and prefixed `whatsapp_`. Every tool ships a zod
`inputSchema`, an `outputSchema` returning
`{ messageId, recipientPhone, wabaPhoneNumberId }` (for sends)
or a tool-specific shape (for reads), and a per-tool
`description` the LLM reads when deciding which tool to invoke.

## At a glance

| Tool                                | Window-gated | Annotations      | Wraps                                   |
| ----------------------------------- | ------------ | ---------------- | --------------------------------------- |
| `whatsapp_send_text`                | yes          | —                | `client.sendText`                       |
| `whatsapp_send_image`               | yes          | —                | `client.sendImage`                      |
| `whatsapp_send_video`               | yes          | —                | `client.sendVideo`                      |
| `whatsapp_send_audio`               | yes          | —                | `client.sendAudio`                      |
| `whatsapp_send_voice`               | yes          | —                | `client.sendVoice`                      |
| `whatsapp_send_document`            | yes          | —                | `client.sendDocument`                   |
| `whatsapp_send_location`            | yes          | —                | `client.sendLocation`                   |
| `whatsapp_send_contacts`            | yes          | —                | `client.sendContacts`                   |
| `whatsapp_send_interactive_buttons` | yes          | —                | `client.sendInteractive` (button shape) |
| `whatsapp_send_interactive_list`    | yes          | —                | `client.sendInteractive` (list shape)   |
| `whatsapp_send_template`            | **exempt**   | —                | `client.sendTemplate`                   |
| `whatsapp_send_auth_template`       | **exempt**   | —                | `client.sendAuthTemplate`               |
| `whatsapp_send_carousel_template`   | **exempt**   | —                | `client.sendCarouselTemplate`           |
| `whatsapp_send_reaction`            | **exempt**   | `idempotentHint` | `client.sendReaction`                   |
| `whatsapp_list_templates`           | n/a          | `readOnlyHint`   | `client.listTemplates`                  |
| `whatsapp_get_template`             | n/a          | `readOnlyHint`   | `client.getTemplate`                    |

**Window-gated** tools enforce the 24-hour customer-service
window. If the window is closed for the recipient, the tool
returns `{ isError: true }` with a recovery hint pointing at
`whatsapp_send_template`. **Window-exempt** tools work regardless
of window state.

## Output shape (send tools)

Every send tool returns the same `structuredContent`:

```ts
{
  messageId: string,          // Meta-issued wamid
  recipientPhone: string,     // E.164 — the recipient
  wabaPhoneNumberId: string,  // which WABA-phone pair this server is bound to
}
```

The three fields are held stable across every send tool so the
LLM doesn't have to learn a different output shape per verb. This
also dodges the
[MCP SDK issue #654](https://github.com/modelcontextprotocol/typescript-sdk/issues/654)
silent error-swallow when `structuredContent` and `outputSchema`
drift apart.

## Send tools

### `whatsapp_send_text`

The bread-and-butter outbound send.

| Input        | Type            | Notes                                          |
| ------------ | --------------- | ---------------------------------------------- |
| `to`         | string (E.164)  | recipient phone                                |
| `body`       | string (1–4096) | plaintext, supports line breaks + emoji        |
| `previewUrl` | boolean?        | render link preview for URLs in body           |
| `replyTo`    | string?         | wamid to quote-reply to (must be from inbound) |

Window-gated. The most common error path: `WINDOW_CLOSED` →
re-route through `whatsapp_send_template`.

### `whatsapp_send_image` / `_video` / `_audio` / `_voice` / `_document`

Media sends. All take either a `link` (public HTTPS URL Meta
will fetch) or an `id` (a pre-uploaded media id from
`POST /{phone-number-id}/media`). **The model produces links;
the SDK produces ids.** Agents almost always want `link`.

| Input      | Type           | Notes                                  |
| ---------- | -------------- | -------------------------------------- |
| `to`       | string (E.164) | recipient                              |
| `link`     | string (URL)?  | exactly one of link/id                 |
| `id`       | string?        | exactly one of link/id                 |
| `caption`  | string?        | image / video / document only          |
| `filename` | string?        | document only — shown to the recipient |
| `replyTo`  | string?        | wamid to quote-reply to                |

`_voice` is the special case: it sets `voice: true` on the audio
message, which triggers transcription support, auto-download,
and the "played" delivery status. Use `_audio` for everything
else (music files, ringtones, podcast clips).

### `whatsapp_send_location`

| Input       | Type               | Notes                   |
| ----------- | ------------------ | ----------------------- |
| `to`        | string             | recipient               |
| `latitude`  | number (−90, 90)   | decimal degrees         |
| `longitude` | number (−180, 180) | decimal degrees         |
| `name`      | string?            | shown above the map pin |
| `address`   | string?            | human-readable address  |

Both `latitude` and `longitude` are zod-validated; values out
of range come back as a validation `isError`.

### `whatsapp_send_contacts`

Sends one or more vCard-style contact cards in a single message.

| Input      | Type       | Notes                                                                                |
| ---------- | ---------- | ------------------------------------------------------------------------------------ |
| `to`       | string     | recipient                                                                            |
| `contacts` | array (1+) | each card has `name.formatted_name` + optional `phones`, `emails`, `org`, `birthday` |

### `whatsapp_send_interactive_buttons`

Body + 1–3 quick-reply buttons. Each button has a stable `id`
that lands back on the inbound webhook when the user taps.

| Input     | Type        | Notes                                  |
| --------- | ----------- | -------------------------------------- |
| `to`      | string      | recipient                              |
| `body`    | string      | main message body                      |
| `buttons` | array (1–3) | each `{ id, title }`                   |
| `header`  | object?     | text / image / video / document header |
| `footer`  | string?     | small footer text                      |

The header is a discriminated union — `{ type: "text", text }` or
`{ type: "image", image: { link?, id? } }`, etc.

### `whatsapp_send_interactive_list`

Body + sectioned list of selectable rows.

| Input      | Type         | Notes                                |
| ---------- | ------------ | ------------------------------------ |
| `to`       | string       | recipient                            |
| `body`     | string       | main message body                    |
| `button`   | string       | label for the "View options" button  |
| `sections` | array (1–10) | each `{ title, rows: 1–10 entries }` |
| `header`   | object?      | text header only (no media on list)  |
| `footer`   | string?      |                                      |

### `whatsapp_send_template`

The canonical way to **re-engage a customer outside the 24-hour
window**.

| Input        | Type    | Notes                                        |
| ------------ | ------- | -------------------------------------------- |
| `to`         | string  | recipient                                    |
| `name`       | string  | template name, case-sensitive                |
| `language`   | string  | BCP-47 code, e.g. `en_US`, `es_MX`           |
| `components` | array?  | parameter overrides (header / body / button) |
| `replyTo`    | string? | wamid to quote-reply to                      |

Inspect a template's `components` shape via
`whatsapp_get_template` before calling this tool — the parameter
count must match the approved template exactly.

### `whatsapp_send_auth_template`

OTP / verification-code template. The SDK duplicates the OTP into
both the body and the URL-button parameters automatically (Meta's
documented requirement; easy to get wrong by hand).

| Input            | Type          | Notes                           |
| ---------------- | ------------- | ------------------------------- |
| `to`             | string        | recipient                       |
| `name`           | string        | approved auth-template name     |
| `language`       | string        | BCP-47                          |
| `otp`            | string (1–15) | the verification code           |
| `otpButtonIndex` | string?       | URL button index, default `"0"` |

### `whatsapp_send_carousel_template`

1–10 media-card carousel. Each card has an image or video header
and optional body parameters + buttons.

| Input            | Type         | Notes                                                                   |
| ---------------- | ------------ | ----------------------------------------------------------------------- |
| `to`             | string       | recipient                                                               |
| `name`           | string       | approved carousel-template name                                         |
| `language`       | string       | BCP-47                                                                  |
| `bodyParameters` | string[]?    | top-level body substitutions                                            |
| `cards`          | array (1–10) | each `{ header: { type, mediaId?, link? }, bodyParameters?, buttons? }` |

### `whatsapp_send_reaction`

Emoji-react to a specific message. Window-exempt. Marked
`idempotentHint: true` because re-sending the same emoji is a
no-op.

| Input       | Type   | Notes                                  |
| ----------- | ------ | -------------------------------------- |
| `to`        | string | recipient                              |
| `messageId` | string | wamid of the message to react to       |
| `emoji`     | string | single emoji, or empty string to clear |

## Read tools

### `whatsapp_list_templates`

Lists approved templates for the bound WABA. Marked
`readOnlyHint: true`.

| Input              | Type            | Notes                                             |
| ------------------ | --------------- | ------------------------------------------------- |
| `status`           | string?         | filter (`APPROVED`, `PENDING`, `REJECTED`)        |
| `category`         | string?         | filter (`MARKETING`, `UTILITY`, `AUTHENTICATION`) |
| `language`         | string?         | filter by language code                           |
| `name`             | string?         | filter by exact name                              |
| `limit`            | number? (1–100) | page size                                         |
| `after` / `before` | string?         | cursor pagination                                 |

### `whatsapp_get_template`

Fetches a single template by id. Marked `readOnlyHint: true`.
Use the returned `components` to ground a subsequent
`whatsapp_send_template` call.

| Input        | Type   | Notes                             |
| ------------ | ------ | --------------------------------- |
| `templateId` | string | id from `whatsapp_list_templates` |

## Why some "obvious" tools aren't here

- **`whatsapp_send_sticker`** — minimal agentic value, defer
  until someone asks.
- **`whatsapp_send_reply`** — needs an `inReplyTo` wamid that
  only exists from inbound webhooks (which the MCP server
  doesn't see). Use `replyTo` on the existing send tools if you
  have a wamid via the hybrid pattern.
- **`whatsapp_mark_as_read`** — only useful when wired to an
  inbound stream; defer with the rest of inbound.
- **Media upload (`POST /media`)** — the model can't produce raw
  bytes. Pass a public URL via `link` and let Meta fetch it.

## Constants

The package exports stable string constants for every tool name
— useful for permission filtering or programmatic registration:

```ts
import {
  SEND_TEXT_TOOL,
  SEND_TEMPLATE_TOOL,
  // ... 14 more
} from "@dojocoding/whatsapp-mcp";

if (toolName === SEND_TEXT_TOOL) {
  /* ... */
}
```

See [`error-recovery.md`](./error-recovery.md) for what each
`isError: true` shape means and how the LLM should react.
