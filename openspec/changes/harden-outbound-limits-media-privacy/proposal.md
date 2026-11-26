# Change proposal — harden outbound limits, BSUID recipients, media security and error privacy

Affected capabilities: `message-builders`, `cloud-api-client`, `mock-mode`.

## Why

The November 2026 outbound audit (`matrix-outbound.md`) checked the
send builders, media helpers and error surface against Meta's current
docs:

- The list message body is "Maximum 4096 characters", but the SDK
  capped it at 1024, and a test locked in the wrong value (row 9).
- `buildInteractiveCtaUrl` accepted any URL `new URL()` parses,
  including `javascript:`, `data:` and `http:`. These are LLM-composed
  URLs (row 12).
- `buildReaction` accepted `replyTo` and attached `context`. Meta:
  "You cannot send a reaction message as a contextual reply" (row 6).
- Meta has accepted sends addressed by business-scoped user ID
  (`recipient`) since July 2026. The SDK had no `recipient` field, so a
  user with no `wa_id` could not be messaged. The window and opt-in
  gates were keyed on `to` only (row 2).
- Media download problems (rows 27, 28, 29):
  - There was no byte cap.
  - The WABA bearer token was attached to any URL and scheme,
    including redirects.
  - `mediaId` was interpolated unencoded into the Graph path, a
    confused-deputy risk.
- The upload MIME types were not allowlisted, and the sticker
  100 KB / 500 KB ceilings could not be reached (rows 18, 19, 23).
- `WhatsAppError` messages built from Meta's `error.message` can echo
  the recipient's phone number, and so can `WindowClosedError` and
  `UndeliverableError` (privacy).
- The docs described the Free Entry Point window as 72 h. Meta now says
  it "may remain open for up to 7 days" (row 31).

## What Changes

- `MESSAGE_LENGTH_LIMITS.listBody = 4096`. Button and cta_url bodies
  stay at 1024.
- `cta.url` must use `https:`.
- `buildReaction` rejects `replyTo`, and `sendReply` rejects reaction
  payloads (both real and mock clients).
- Builders accept exactly one of `to` / `recipient`:
  - `recipient` must be BSUID-shaped, and a BSUID-shaped `to` is
    rejected.
  - `buildAuthTemplate` is phone-only (Meta code 131062).
  - The window, opt-in and rate-limit gates key on `recipientKeyOf(input)`.
- Media downloads:
  - `maxBytes` option (default 100 MB), checked early against
    `fileSize` and `Content-Length`, with a streamed cap.
  - The bearer token is only sent to `https:` Meta media hosts, and
    every redirect hop is re-validated (manual redirect).
  - `encodeURIComponent(mediaId)` in the Graph path.
  - New typed errors `MediaTooLargeError` and `UntrustedMediaUrlError`.
- Uploads: an optional `family` hint (stickers) and a Meta MIME
  allowlist for image/audio/video. Documents are checked only with
  `strictMimeType`. New error `UnsupportedMediaTypeError`.
- `redactProviderMessages` client option (default `false`, also on the
  mock) plus an exported `redactProviderMessage(err)`.
- Docs: BSUID keying guidance and the FEP "up to 7 days" wording
  (pricing only, not a send gate).

## Deferred

- `recipient_type: "group"`. Group sends need Groups API ids, group
  webhooks and management, so they belong in a separate capability.
  `RecipientType` stays `"individual"` and is documented as such (row 1).
- Interactive `location_request_message`, `voice_call`, `flow`,
  `address` and the non-template media carousel (rows 13, 14). These are
  new builders, not hardening, and the voice-call limits are UNVERIFIED.
- SHA-256 verification of downloaded bytes, and FEP / CTWA-aware cost
  tracking.

## Impact

Mostly additive. The breaking changes, all documented in the CHANGELOG:

- `buildReaction` / `sendReply` reaction contexts are now rejected.
- `Build*Input` interfaces became `RecipientAddress & {...}` aliases.
- `BaseMessage.to` and `MessageSendResponseContact.wa_id` are optional.
- Unsupported image/audio/video MIME uploads fail before the request.
