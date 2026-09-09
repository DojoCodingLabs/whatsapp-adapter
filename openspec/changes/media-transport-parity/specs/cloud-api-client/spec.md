## ADDED Requirements

### Requirement: Media-bytes downloads go through the transport
The package SHALL expose `fetchExternal(client, url, options?)` in the client layer: an authenticated `GET` of a non-Graph URL (Meta's media CDN) that resolves to a `Uint8Array`. It SHALL send `Authorization: Bearer <token>` and `X-Request-Id`, honour `options.fetchImpl`, `options.signal`, `options.retryPolicy` and `options.retryHooks`, retry `408` / `429` / `5xx` with the same backoff and `Retry-After` handling as `request()`, and wrap every escaping failure into a `WhatsAppError` subclass exactly as `request()` does (`RateLimitError`, `TransientError`, `NetworkError`, `RequestAbortedError`).

A CDN response of `401`, `403`, `404` or `410` SHALL throw `MediaExpiredError` (`code: "MEDIA_EXPIRED"`, `httpStatus`, optional `mediaId`) without retrying. Any other non-2xx SHALL throw `WhatsAppError("UNKNOWN")` naming the status. Neither message SHALL contain the URL.

`DownloadedMedia.fetchBytes(options?)` and the exported `fetchMediaUrl(client, url, options?)` SHALL delegate to `fetchExternal`. `downloadMedia(mediaId, options)` SHALL pass its `retryPolicy`, `retryHooks` and `fetchImpl` on to `fetchBytes()` as defaults (not `signal` / `requestId`). `fetchMediaUrl` SHALL additionally accept a bare `AbortSignal` as its third argument.

#### Scenario: fetchBytes sends the bearer to the CDN and returns the body
- **GIVEN** `GET /{media-id}` returns `{ url: <cdn-url>, mime_type, sha256, file_size, id }`
- **WHEN** `const m = await client.downloadMedia(id); await m.fetchBytes({ requestId: "corr-1" })`
- **THEN** the CDN receives `Authorization: Bearer <token>` and `X-Request-Id: corr-1`
- **AND** the resolved `Uint8Array` equals the response body

#### Scenario: Expired URL surfaces as MediaExpiredError without retry
- **GIVEN** the CDN answers `403`
- **WHEN** `m.fetchBytes({ retryPolicy: { maxAttempts: 3, … } })` is awaited
- **THEN** it rejects with `MediaExpiredError` whose `httpStatus === 403` and `mediaId === id`
- **AND** the CDN was hit exactly once
- **AND** `error.message` does not contain the URL's query string

#### Scenario: CDN 503 is retried and surfaces TransientError
- **GIVEN** the CDN answers `503` on every attempt and `maxAttempts: 3`
- **WHEN** `m.fetchBytes()` is awaited
- **THEN** it rejects with `TransientError` (`httpStatus === 503`) after 3 attempts
- **AND** the `whatsapp.media.fetch` span has `whatsapp.retry.count === 2`

#### Scenario: CDN 429 honours Retry-After
- **GIVEN** the CDN answers `429` with `Retry-After: 2` and a policy with `maxDelayMs ≥ 2000`
- **WHEN** `m.fetchBytes()` is awaited with a stubbed `sleep`
- **THEN** `sleep` is called with `2000`
- **AND** the call rejects with `RateLimitError` whose `retryAfterMs === 2000`

#### Scenario: fetchImpl is honoured on both steps
- **WHEN** `client.downloadMedia(id, { fetchImpl })` is followed by `fetchBytes()`
- **THEN** `fetchImpl` is called for the Graph lookup and again for the CDN URL, and the global `fetch` is never used

#### Scenario: fetchMediaUrl accepts a bare AbortSignal
- **WHEN** `fetchMediaUrl(client, url, new AbortController().signal)` is called
- **THEN** it behaves as `fetchMediaUrl(client, url, { signal })`

### Requirement: Media-bytes downloads emit an OTel span
Every `fetchExternal` call SHALL be wrapped in `withSpan("whatsapp.media.fetch", …)` carrying `whatsapp.method` (`"GET"`), `whatsapp.media.host` (the URL's host only), `whatsapp.phone_number_id` (hashed), `whatsapp.request.id`, `whatsapp.retry.count` (always), `whatsapp.retry.reason` (when count > 0) and, on failure, `whatsapp.error.code`. No attribute SHALL contain the URL path or query string, the bearer token, or the raw `phone_number_id`.

#### Scenario: Span carries the host but not the signed query
- **GIVEN** a CDN URL `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=…&hash=SECRET`
- **WHEN** `fetchBytes()` succeeds
- **THEN** a span named `whatsapp.media.fetch` is exported with `whatsapp.media.host === "lookaside.fbsbx.com"`
- **AND** no string attribute contains `hash=`, the bearer token, or the raw phone-number id

### Requirement: Input-shape errors are typed WhatsAppErrors
Every public method's own input validation (`uploadMedia`, `downloadMedia`, `fetchMediaUrl`, `markAsRead` / `buildMarkReadPayload`, `getTemplate`, `sendReply`) SHALL throw or reject with `WhatsAppError("UNKNOWN", …)` — never a bare `TypeError` or `Error` — before any HTTP call. Oversize uploads SHALL throw `WhatsAppError("CAPABILITY", …)`. `media/upload.ts` SHALL export `validateUploadInput(input): number` (shape + size gate, returns byte length), `assertSizeAllowed` and `payloadByteLength`.

#### Scenario: Empty mediaId
- **WHEN** `client.downloadMedia("")` is awaited
- **THEN** it rejects with a `WhatsAppError` whose `code === "UNKNOWN"` and which is not an `instanceof TypeError`
- **AND** no HTTP request is made

#### Scenario: Empty wamid on markAsRead
- **WHEN** `client.markAsRead({ messageId: "" })` is awaited
- **THEN** it rejects with `WhatsAppError("UNKNOWN")` and no HTTP request is made

#### Scenario: Oversize upload
- **WHEN** `client.uploadMedia({ file: new Uint8Array(5 * 1024 * 1024 + 1), mimeType: "image/jpeg" })` is awaited
- **THEN** it rejects with `WhatsAppError` whose `code === "CAPABILITY"` and no HTTP request is made

#### Scenario: sendReply with empty wamid
- **WHEN** `client.sendReply("", buildText({ to, body: "x" }))` is awaited
- **THEN** it rejects with `WhatsAppError("UNKNOWN")`

### Requirement: uploadMedia and markAsRead HTTP contract
`uploadMedia` SHALL `POST /{phone-number-id}/media` as `multipart/form-data` with parts `messaging_product=whatsapp`, `type=<mimeType>` and `file=<Blob>` (filename from `input.filename`, default `upload`), letting `fetch` set the multipart boundary. `markAsRead` SHALL `POST /{phone-number-id}/messages` with `{ messaging_product: "whatsapp", status: "read", message_id }` plus `typing_indicator: { type: "text" }` when `typing === true`, and SHALL NOT consult the `WindowTracker`. Both SHALL map Meta error envelopes through `mapMetaError` and retry through the standard policy.

#### Scenario: Upload wire shape
- **WHEN** `client.uploadMedia({ file: bytes, mimeType: "image/jpeg", filename: "a.jpg" })` is awaited against a stub returning `{ id: "MEDIA-123" }`
- **THEN** the request `Content-Type` starts with `multipart/form-data; boundary=`
- **AND** the form has `messaging_product === "whatsapp"`, `type === "image/jpeg"` and a `file` Blob of the same byte length
- **AND** the call resolves to `{ id: "MEDIA-123" }`

#### Scenario: markAsRead is window-independent
- **GIVEN** a client with a `WindowTracker` that has never seen the recipient
- **WHEN** `client.sendText(...)` rejects with `WindowClosedError`
- **THEN** `client.markAsRead({ messageId: "wamid.X" })` still resolves to `{ success: true }`

#### Scenario: markAsRead with typing
- **WHEN** `client.markAsRead({ messageId: "wamid.X", typing: true })` is awaited
- **THEN** the posted body equals `{ messaging_product: "whatsapp", status: "read", message_id: "wamid.X", typing_indicator: { type: "text" } }`
