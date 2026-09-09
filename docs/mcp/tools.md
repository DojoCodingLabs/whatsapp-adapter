# Tools

The MCP server registers 19 tools. Every tool name is
`snake_case` and prefixed `whatsapp_`. Every tool ships a zod
`inputSchema`, an `outputSchema` returning
`{ messageId, recipientPhone, wabaPhoneNumberId }` (for sends)
or a tool-specific shape (for reads), and a per-tool
`description` the LLM reads when deciding which tool to invoke.

## At a glance

| Tool                                | Window-gated | Annotations      | Wraps                                    |
| ----------------------------------- | ------------ | ---------------- | ---------------------------------------- |
| `whatsapp_send_text`                | yes          | —                | `client.sendText`                        |
| `whatsapp_send_image`               | yes          | —                | `client.sendImage`                       |
| `whatsapp_send_video`               | yes          | —                | `client.sendVideo`                       |
| `whatsapp_send_audio`               | yes          | —                | `client.sendAudio`                       |
| `whatsapp_send_voice`               | yes          | —                | `client.sendVoice`                       |
| `whatsapp_send_document`            | yes          | —                | `client.sendDocument`                    |
| `whatsapp_send_location`            | yes          | —                | `client.sendLocation`                    |
| `whatsapp_send_contacts`            | yes          | —                | `client.sendContacts`                    |
| `whatsapp_send_interactive_buttons` | yes          | —                | `client.sendInteractive` (button shape)  |
| `whatsapp_send_interactive_list`    | yes          | —                | `client.sendInteractive` (list shape)    |
| `whatsapp_send_template`            | **exempt**   | —                | `client.sendTemplate`                    |
| `whatsapp_send_auth_template`       | **exempt**   | —                | `client.sendAuthTemplate`                |
| `whatsapp_send_carousel_template`   | **exempt**   | —                | `client.sendCarouselTemplate`            |
| `whatsapp_send_reaction`            | yes          | `idempotentHint` | `client.sendReaction`                    |
| `whatsapp_list_templates`           | n/a          | `readOnlyHint`   | `client.listTemplates`                   |
| `whatsapp_get_template`             | n/a          | `readOnlyHint`   | `client.getTemplate`                     |
| `whatsapp_mark_as_read`             | no (ack)     | `idempotentHint` | `client.markAsRead`                      |
| `whatsapp_upload_media_from_url`    | n/a          | —                | `client.uploadMedia` (server-side fetch) |
| `whatsapp_get_media_info`           | n/a          | `readOnlyHint`   | `client.downloadMedia` (metadata only)   |

**Window-gated** tools enforce the 24-hour customer-service
window. If the window is closed for the recipient, the tool
returns `{ isError: true }` with a recovery hint pointing at
`whatsapp_send_template`. **Window-exempt** tools work regardless
of window state — Meta exempts **only approved templates**, so
the three `*_template` tools are the only exempt sends; reactions
are gated like every other free-form send. `whatsapp_mark_as_read`
is an acknowledgement, not a message, and is window-independent.

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

Emoji-react to a specific message. **Window-gated** — Meta exempts
only approved templates from the 24-hour rule, so a reaction
outside the window returns `WINDOW_CLOSED`. Marked
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

### `whatsapp_get_media_info`

Resolves metadata for an inbound or previously-uploaded media id.
Marked `readOnlyHint: true`, `idempotentHint: true`. Returns
**metadata only** — never the bytes and never Meta's pre-signed
download URL (it is bearer-authenticated and expires in ~5 minutes,
so handing it to the model is useless and leaks the bearer's
existence). To process media, your server-side code calls
`client.downloadMedia(mediaId)` and proxies the bytes through your
own storage.

| Input     | Type   | Notes                                                                   |
| --------- | ------ | ----------------------------------------------------------------------- |
| `mediaId` | string | from an inbound `message` event (`event.body.image.id`, …) or an upload |

Output: `{ id, mimeType, sha256, fileSize }`. An unknown id maps to
`isError` with the SDK's error code; an expired CDN URL (only
reachable via `fetchBytes`, not this tool) maps to `MEDIA_EXPIRED`.

## Ack tools

### `whatsapp_mark_as_read`

Acknowledge an inbound message (blue double-tick) and optionally
show a typing indicator while the agent composes a reply. Marked
`idempotentHint: true`. **Window-independent** — acks are not
messages and never consult the window tracker. Free of charge
under Meta's per-message pricing, which makes `typing: true` the
right way to signal activity instead of sending a "one moment…"
filler message.

| Input       | Type     | Notes                                                                                         |
| ----------- | -------- | --------------------------------------------------------------------------------------------- |
| `messageId` | string   | inbound wamid from the `message` webhook event                                                |
| `typing`    | boolean? | also show a typing indicator; auto-dismisses when you send a reply or after ~25 s (Meta-side) |

Output: `{ success, messageId, typing }`.

## Media tools

### `whatsapp_upload_media_from_url`

Fetches a **public `https://` URL server-side** and uploads the
bytes to Meta as a reusable media id. Use it when the agent has
already produced the artefact at a URL (S3 pre-signed URL,
generated PDF, image-gen output) and wants a `mediaId` for a
subsequent send tool. MCP cannot reliably transport binary blobs
through JSON-RPC stdio, so the URL-fetch indirection is the
supported path.

| Input       | Type    | Notes                                                                         |
| ----------- | ------- | ----------------------------------------------------------------------------- |
| `sourceUrl` | string  | public `https://` URL; see the guard below                                    |
| `mimeType`  | string  | e.g. `image/jpeg`, `application/pdf`; must match the bytes                    |
| `filename`  | string? | shown to the recipient for documents; defaults to the URL's last path segment |

Output: `{ mediaId, mimeType, bytes }`.

**Source-URL guard.** The server fetches whatever URL the model
supplies, which makes this tool a server-side-request-forgery
vector. Before any network I/O the tool refuses — with
`isError: true` and `error.code === "source_url_rejected"` —
any `sourceUrl` that:

- is not `https://` (so `http://` and `file://` are out),
- embeds credentials (`https://user:pw@…`),
- targets `localhost`, `*.localhost` or `*.local`,
- targets a literal loopback / unspecified / link-local
  (`169.254.0.0/16`, i.e. cloud metadata) / RFC 1918 / `100.64/10`
  IPv4 address, including IPv4-mapped IPv6 spellings, or an IPv6
  loopback / link-local / unique-local literal.

Redirects are **not followed** (`redirect: "error"`), so a 3xx
cannot bounce to a refused host. A hostname that _resolves_ to a
private address is not checked (no pre-flight DNS); if that matters
in your network, enforce egress rules at the deployment layer.

Other failures:

| Condition                          | `error.code`          |
| ---------------------------------- | --------------------- |
| source responds non-2xx            | `source_fetch_failed` |
| `fetch` rejects (refused redirect) | `source_fetch_failed` |
| body exceeds Meta's size ceiling   | `CAPABILITY` (SDK)    |

Size ceilings are enforced before the upload request: image 5 MB,
audio / video 16 MB, document 100 MB, sticker 100 KB / 500 KB.

## Why some "obvious" tools aren't here

- **`whatsapp_send_sticker`** — minimal agentic value, defer
  until someone asks.
- **`whatsapp_send_reply`** — needs an `inReplyTo` wamid that
  only exists from inbound webhooks (which the MCP server
  doesn't see). Use `replyTo` on the existing send tools if you
  have a wamid via the hybrid pattern.
- **`whatsapp_download_media`** — the model has no use for raw
  bytes and the pre-signed URL is bearer-authenticated. Use
  `whatsapp_get_media_info` for metadata and do the byte fetch
  server-side.

## Constants

The package exports stable string constants for every tool name
— useful for permission filtering or programmatic registration:

```ts
import {
  SEND_TEXT_TOOL,
  SEND_TEMPLATE_TOOL,
  // ... 17 more
} from "@dojocoding/whatsapp-mcp";

if (toolName === SEND_TEXT_TOOL) {
  /* ... */
}
```

See [`error-recovery.md`](./error-recovery.md) for what each
`isError: true` shape means and how the LLM should react.
