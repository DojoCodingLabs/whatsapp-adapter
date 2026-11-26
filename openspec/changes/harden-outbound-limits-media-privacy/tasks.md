## 1. Builders

- [x] 1.1 Add `MESSAGE_LENGTH_LIMITS.listBody = 4096` and use it in `buildInteractiveList`. Fix `length-limits.test.ts`.
- [x] 1.2 `buildInteractiveCtaUrl` rejects non-`https:` URLs. Add tests for `javascript:`, `http:`, `data:` and `ftp:`.
- [x] 1.3 `buildReaction` rejects `replyTo` and never emits `context`. `sendReply` rejects reaction payloads on the real and mock clients.
- [x] 1.4 Add `RecipientAddress` (`to` | `recipient`, exactly one), `BSUID_PATTERN`, `isBsuid` and `recipientKeyOf`. `buildAuthTemplate` rejects `recipient`.
- [x] 1.5 `BaseMessage.recipient?`. `MessageSendResponseContact` gains `user_id?` and `parent_user_id?`, and `wa_id?` becomes optional.

## 2. Client and mock

- [x] 2.1 Window, opt-in and `withRateLimit` gates key on `recipientKeyOf(input)` (real and mock).
- [x] 2.2 Mock response mirrors BSUID sends (`user_id`, no `wa_id`).
- [x] 2.3 `redactProviderMessages` option on the real and mock clients. Export `redactProviderMessage`, applied in `WhatsAppClient.request()` and the pre-flights. `mapMetaError` is untouched.

## 3. Media

- [x] 3.1 `fetchExternal`: https and trusted-host check before the token is attached, `redirect: "manual"` with re-validated hops (max 3), and a `maxBytes` streamed cap.
- [x] 3.2 `downloadMedia`: `encodeURIComponent(mediaId)`, `DownloadMediaOptions` (`maxBytes`, `isTrustedMediaHost`) inherited by `fetchBytes()`, and an early `fileSize > maxBytes` rejection. The mock has parity.
- [x] 3.3 Upload: `family` hint, `MEDIA_SUPPORTED_MIME_TYPES` allowlist and `strictMimeType`. Add `UnsupportedMediaTypeError`.
- [x] 3.4 msw contract tests for the cap, untrusted URL, redirects and path encoding. Unit tests for MIME and family.

## 4. Docs

- [x] 4.1 `docs/sdk/messages.md`: addressing, reactions, limits table.
- [x] 4.2 `docs/sdk/client.md`: `redactProviderMessages` and download hardening.
- [x] 4.3 `docs/sdk/window.md`: BSUID keying, FEP "up to 7 days".
- [x] 4.4 `docs/compliance.md`: FEP wording, media rule, recommend `redactProviderMessages: true`.
- [x] 4.5 CHANGELOG `[Unreleased]`, and the public-surface drift detector.
