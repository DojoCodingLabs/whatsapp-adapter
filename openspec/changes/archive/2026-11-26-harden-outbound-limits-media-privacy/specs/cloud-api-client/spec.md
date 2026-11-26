## ADDED Requirements

### Requirement: Window and opt-in pre-flights key on the addressed identifier

`WhatsAppClient` SHALL pass `recipientKeyOf(input)` (the `to` value, otherwise the `recipient` BSUID) to `WindowTracker.isWindowOpen` and to `OptInRegistry.isOptedIn`.

#### Scenario: Window opened for the BSUID allows a BSUID send

- **WHEN** `tracker.notifyInbound("US.13491208655302741918")` has been called
- **AND** `client.sendText({ recipient: "US.13491208655302741918", body })` is called
- **THEN** the request is issued with `recipient` in the body

#### Scenario: Window opened for the phone number does not open the BSUID

- **WHEN** only `tracker.notifyInbound(phone)` has been called
- **AND** `client.sendText({ recipient: bsuid, body })` is called
- **THEN** it rejects with `WindowClosedError` and no HTTP request is issued

### Requirement: Media bearer token is only sent to https Meta hosts

Media byte fetches (`fetchBytes`, `fetchMediaUrl`) SHALL attach the bearer token only to `https:` URLs whose host matches `*.fbsbx.com`, `*.fbcdn.net` or `graph.facebook.com`, or a caller-supplied `isTrustedMediaHost` that cannot waive `https:`. They SHALL NOT follow redirects automatically; each target SHALL be re-validated (max 3 hops). Failures SHALL reject with `UntrustedMediaUrlError` before the token is sent.

#### Scenario: Redirect to a foreign host is refused

- **WHEN** the CDN answers 302 with `Location: https://attacker.example/x`
- **THEN** `fetchBytes()` rejects with `UntrustedMediaUrlError` (`reason: "untrusted_host"`)
- **AND** no request reaches `attacker.example`

### Requirement: Media downloads are size-capped

Media byte fetches SHALL enforce `maxBytes` (default 100 MB) and reject with `MediaTooLargeError` (a `CapabilityError`) when Meta's `fileSize` exceeds it (before any byte request), when `Content-Length` exceeds it, or when the streamed body overruns it (the read is cancelled).

#### Scenario: Oversized media is refused before download

- **WHEN** `GET /{media-id}` reports `file_size: 2048` and `maxBytes: 1024`
- **THEN** `fetchBytes()` rejects with `MediaTooLargeError` and the CDN is never called

### Requirement: Media ids are path-encoded

`downloadMedia` SHALL `encodeURIComponent` the `mediaId` in the Graph path.

#### Scenario: Media id cannot reach other endpoints

- **WHEN** `downloadMedia("123?fields=access_token")` is called
- **THEN** the request path is `/v26.0/123%3Ffields%3Daccess_token`

### Requirement: Upload MIME allowlist and sticker family

`uploadMedia` SHALL reject an `image/*`, `audio/*` or `video/*` MIME type not on Meta's documented list (`MEDIA_SUPPORTED_MIME_TYPES`) with `UnsupportedMediaTypeError` (a `CapabilityError`), before the request. It SHALL honour an explicit `family` (`sticker_static` 100 KB, `sticker_animated` 500 KB, `image/webp` only). It SHALL check document MIME types only when `strictMimeType: true`.

#### Scenario: GIF upload rejected locally

- **WHEN** `uploadMedia({ file, mimeType: "image/gif" })` is called
- **THEN** it rejects with `UnsupportedMediaTypeError` and no request is issued

#### Scenario: Static sticker ceiling

- **WHEN** `uploadMedia({ file: 100 KB + 1 bytes, mimeType: "image/webp", family: "sticker_static" })` is called
- **THEN** it rejects naming the `sticker_static` ceiling

### Requirement: Optional redaction of provider error text

When `WhatsAppClientOptions.redactProviderMessages` is `true` (default `false`), errors whose message carries Meta's text or the recipient (including pre-flight `WindowClosedError` / `OptOutError`) SHALL get a generic message and stack header. Class, `code`, `metaCode`, `httpStatus` and `cause` SHALL be kept, `customerWaId` SHALL be reduced to a last-4 form, and `toJSON()` SHALL NOT contain the recipient.

#### Scenario: Capability error text redacted

- **WHEN** Meta answers `{ error: { code: 100, message: "... 15551234567 ..." } }` and the option is on
- **THEN** the thrown `CapabilityError` has `metaCode === 100`
- **AND** its message and `JSON.stringify` output do not contain `15551234567`

#### Scenario: Default keeps provider text

- **WHEN** the option is omitted
- **THEN** Meta's `error.message` text is preserved
