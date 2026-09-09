## 1. Errors

- [x] 1.1 `MEDIA_EXPIRED` in `WhatsAppErrorCode`; `MediaExpiredError` (`httpStatus`, `mediaId?`) in `src/types/errors.ts`; root export; public-surface list.
- [x] 1.2 Unit: hierarchy / discriminator / message in `test/unit/types/errors.test.ts`.

## 2. Transport

- [x] 2.1 Extract `retryWithTelemetry` from `request()`; `request()` delegates to it.
- [x] 2.2 `fetchExternal(client, url, options)` + `doFetchBytes` (bearer, `X-Request-Id`, `MediaExpiredError` on 401/403/404/410, `TransientHttpError` on retryable statuses, `UNKNOWN` otherwise) under a `whatsapp.media.fetch` span with host-only attribute.
- [x] 2.3 Export `ExternalFetchOptions` (root + `client/index.ts`).

## 3. Media modules

- [x] 3.1 `download.ts`: `downloadMedia` validates with `WhatsAppError`, inherits policy/hooks/fetchImpl into `fetchBytes`, passes `mediaId`; `fetchMediaUrl` delegates to `fetchExternal`, accepts options object or bare `AbortSignal`.
- [x] 3.2 `types.ts`: `DownloadedMedia.fetchBytes(options?: MediaFetchOptions)`; export `MediaFetchOptions`.
- [x] 3.3 `upload.ts`: export `payloadByteLength`, `assertSizeAllowed`, `validateUploadInput`; all throws typed.

## 4. Typed throws elsewhere

- [x] 4.1 `conversation-acks/mark-read.ts`, `templates/api.ts`, `client/whatsapp-client.ts#sendReply` → `WhatsAppError("UNKNOWN")`.
- [x] 4.2 Mock: `uploadMedia` uses `validateUploadInput` (delete `mockPayloadByteLength`); `getTemplate("")`, `sendReply("")` typed.
- [x] 4.3 Update four existing `TypeError` assertions.

## 5. Contract + parity tests

- [x] 5.1 `test/contract/media/upload.test.ts`.
- [x] 5.2 `test/contract/media/download.test.ts` (incl. span assertions).
- [x] 5.3 `test/contract/conversation-acks/mark-read.test.ts`.
- [x] 5.4 `test/parity/media-parity.test.ts`.

## 6. MCP

- [x] 6.1 `recoveryHint` branch for `MediaExpiredError`; unit test; discriminator sweep.

## 7. Docs

- [x] 7.1 `docs/sdk/client.md` — "Media upload / download" section + error-table row.
- [x] 7.2 `docs/sdk/observability.md` — `whatsapp.media.fetch` span table.
- [x] 7.3 `docs/compliance.md` table row; `docs/architecture.md`; `docs/compatibility.md`; `docs/mcp/error-recovery.md`; `docs/sdk/messages.md` pointer; cookbook gotcha.
