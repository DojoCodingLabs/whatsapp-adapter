# Change proposal — route media downloads through the transport, align mock ↔ real media behaviour, typed throws everywhere

Affected capabilities: `cloud-api-client`, `mock-mode`, `mcp-server`.

## Why

Audit findings F12, F13, F14 (probes Q1–Q4, P7):

- **F12** — `fetchMediaUrl` (the bytes step behind
  `DownloadedMedia.fetchBytes()`) called the global `fetch` directly.
  No OTel span (violates "every external API call gets a span"), no
  `fetchImpl` override, no retry / `Retry-After`, and every non-2xx
  collapsed to `WhatsAppError("UNKNOWN")` — including the 403 / 404
  Meta returns once the ~5-minute URL TTL lapses, which is the one
  failure a consumer must handle differently (fetch a fresh URL, don't
  retry).
- **F13** — `MockWhatsAppClient.uploadMedia` skipped the size gate, so
  a 6 MB `image/jpeg` passed in tests and failed in production. Several
  public methods (`sendReply`, `uploadMedia`, `downloadMedia`,
  `getTemplate`, `markAsRead`) threw bare `TypeError` / `Error` for
  input-shape mistakes while the message builders throw
  `WhatsAppError("UNKNOWN")` for the same class of problem — two catch
  patterns for one SDK.
- **F14** — `uploadMedia`, `downloadMedia` and `markAsRead` had no
  msw-backed HTTP-contract test; `download.ts` sat at 1.66 % line
  coverage.

## What changes

### `cloud-api-client`

- New `fetchExternal(client, url, options)` transport helper: bearer
  GET of a non-Graph URL returning `Uint8Array`, wrapped in a
  `whatsapp.media.fetch` span (attributes: method, **host only**,
  hashed `phone_number_id`, `request.id`, retry count / reason, error
  code), sharing the Graph path's retry loop (`408` / `429` / `5xx`,
  `Retry-After`), `fetchImpl` override, caller `signal`, and
  `toPublicError` wrapping. `request()` and `fetchExternal()` share one
  `retryWithTelemetry` core so their semantics cannot drift.
- New typed error `MediaExpiredError` (`code: "MEDIA_EXPIRED"`,
  `httpStatus`, `mediaId?`) for CDN `401` / `403` / `404` / `410`. Not
  retried. Never carries the URL.
- `DownloadedMedia.fetchBytes(options?: MediaFetchOptions)` and
  `fetchMediaUrl(client, url, options?)` accept retry policy / hooks /
  `signal` / `requestId` / `fetchImpl`. `downloadMedia()`'s retry
  policy, hooks and `fetchImpl` are inherited by `fetchBytes()`.
  `fetchMediaUrl` still accepts a bare `AbortSignal` third argument
  for `0.9.x` compatibility.
- Input-shape validation on `uploadMedia`, `downloadMedia`,
  `fetchMediaUrl`, `markAsRead` (`buildMarkReadPayload`),
  `getTemplate`, `sendReply` throws `WhatsAppError("UNKNOWN")` instead
  of `TypeError` / `Error`. Oversize uploads keep
  `WhatsAppError("CAPABILITY")`.
- `media/upload.ts` exports `validateUploadInput`, `assertSizeAllowed`,
  `payloadByteLength`.

### `mock-mode`

- `MockWhatsAppClient.uploadMedia` runs the same `validateUploadInput`
  as the real client (size gate included); `getTemplate("")`,
  `markAsRead({ messageId: "" })`, `sendReply("")` reject with
  `WhatsAppError("UNKNOWN")` like the real client. The mock's private
  byte-length mirror is deleted.

### `mcp-server`

- `recoveryHint` gains a `MediaExpiredError` branch telling the model
  to obtain a fresh URL rather than retry.

## Tests

- `test/contract/media/upload.test.ts` — multipart wire shape, bearer,
  pre-flight size rejection (zero HTTP), `UNKNOWN` on malformed input,
  `mapMetaError` on 400, `TransientError` after retry exhaustion.
- `test/contract/media/download.test.ts` — lookup → camelCase info →
  bytes with bearer + `X-Request-Id`; `whatsapp.media.fetch` span with
  host only and no signed query / token / raw PNID; `MediaExpiredError`
  for each of 401 / 403 / 404 / 410 with no retry; 503 retried then
  `TransientError` with span retry count; 429 `Retry-After` →
  `RateLimitError`; caller abort → `RequestAbortedError`; `fetchImpl`
  honoured on both steps; input / no-`url` negatives; stand-alone
  `fetchMediaUrl` compat.
- `test/contract/conversation-acks/mark-read.test.ts` — wire body with
  and without `typing_indicator`, window-independence next to a gated
  `sendText`, `UNKNOWN` on empty wamid with zero HTTP, `mapMetaError`
  on 401.
- `test/parity/media-parity.test.ts` — upload / oversize / malformed /
  download+fetchBytes / markAsRead / sendReply("") produce the same
  outcome (resolved shape or `WhatsAppError.code`) on both clients.
- Unit: `MediaExpiredError` hierarchy; MCP hint; public-surface drift
  list; four existing `TypeError` assertions updated.

## Non-goals

- Sticker-specific (100 KB / 500 KB) size gating for `image/webp` —
  still requires the caller to pass the family explicitly.
- Streaming downloads; `fetchBytes()` still buffers the whole body.
