# Changelog

All notable changes to `@dojocoding/whatsapp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0 minor versions may contain breaking changes — see
[`CONTRIBUTING.md`](./CONTRIBUTING.md) § Releases.

## [0.7.1] — 2026-05-11

### Added

- **`verifySignatureOrThrow(input)`** — throwing variant of
  `verifySignature` exported from the root entry. Resolves silently
  on a valid signature; throws `WebhookSignatureError` on bad HMAC,
  missing header, malformed hex, or wrong byte length. Use this when
  wiring your own HTTP layer (not the SDK's Express / web / Hono
  adapters) and you want a typed error rather than a boolean.

### Changed

- **CI: bumped GitHub Actions to Node 24-compatible versions** —
  `actions/checkout@v5`, `actions/setup-node@v6`,
  `pnpm/action-setup@v6`, `actions/upload-artifact@v7`,
  `softprops/action-gh-release@v3`. Removes the deprecation banner
  on every CI run; ready for Meta's 2026-06-02 Node 20 default
  removal.

### Tests

- Added `test/contract/public-surface.test.ts` — a drift detector
  asserting every documented value/class/factory across the root
  entry and all five subpaths (`/express`, `/web`, `/hono`,
  `/storage/redis`, `/storage/postgres`) is reachable at runtime.
  If a sub-module export is added without being plumbed through, or
  a documented export is accidentally renamed/removed, this test
  fails before consumers do.
- Added negative-path coverage for `WebhookSignatureError` (5 new
  tests via `verifySignatureOrThrow`) and `MockModeError` (4 new
  contract tests pinning the public shape).
- Re-shimmed `test/integration/express/middleware.test.ts` to use a
  Promise-resolved-by-handler pattern instead of 5 ms `setTimeout`
  waits and wall-clock ack-timing windows — mirrors the
  determinism fix already applied to the web adapter test in 0.2.0.

524 tests pass (was 447).

## [0.7.0] — 2026-05-11

### Added

- **Authentication template (OTP) builder.** `buildAuthTemplate({
to, name, language, otp, otpButtonIndex? })` and the matching
  `client.sendAuthTemplate(...)` produce the documented copy-code /
  one-tap / zero-tap wire payload with the OTP code duplicated into
  both the body and URL-button parameters (the canonical footgun
  this builder exists to remove). OTP length validated against
  Meta's 15-char ceiling.
- **Voice-note builder.** `buildVoice({ to, id|link })` and
  `client.sendVoice(...)` produce audio messages with `voice: true`,
  triggering transcription support, auto-download, and the "played"
  delivery status.
- **Carousel-template builder.** `buildCarouselTemplate({ to, name,
language, bodyParameters?, cards })` and
  `client.sendCarouselTemplate(...)` produce media-card carousel
  template sends with 1–10 cards. Each card's `card_index` is
  computed from iteration order; consumers can't misorder it.
- **Limited-time-offer template support.** Three new
  `TemplateParameter` union variants:
  `TemplateParameterLimitedTimeOffer`,
  `TemplateParameterCouponCode`, and `TemplateParameterPayload`.
  `TemplateComponent.type` widens to accept `"carousel"` and
  `"limited_time_offer"`. Use via the existing `buildTemplate(...)`
  /
  `client.sendTemplate(...)`.
- New `CarouselCardComponent` exported type. `AudioMessage.audio`
  gains an optional `voice?: boolean` field.

Every wire shape is grounded in a Meta doc URL referenced in
source-file JSDoc and pinned via byte-for-byte snapshot tests:

- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/limited-time-offer-templates/

## [0.6.0] — 2026-05-11

### Added

- **Redis and Postgres `Storage` adapters at subpath exports.**
  - `@dojocoding/whatsapp/storage/redis` exports
    `createRedisStorage(client, options?)`. Takes an
    `ioredis`-compatible client; uses native `SET PX` / `SET NX`
    for TTL and atomicity. `ioredis` is an optional peer
    dependency on `^5.0.0`.
  - `@dojocoding/whatsapp/storage/postgres` exports
    `createPostgresStorage(client, options?)` and
    `POSTGRES_STORAGE_SCHEMA: string`. Takes a `pg`-compatible
    client; runs four SQL statements (`SELECT`, two `INSERT ... ON
CONFLICT`, `DELETE`). `pg` is an optional peer dependency on
    `^8.0.0`.
  - Both adapters use minimal structural interfaces (`RedisLike`,
    `PgLike`) so the SDK doesn't import either library at runtime;
    consumers pass any compatible client (including test fakes).
  - See [`docs/storage.md`](./docs/storage.md).
- Shared `Storage` contract test:
  `test/unit/storage/contract.ts` exports a parametrised suite
  that every implementation (`InMemoryStorage`,
  `createRedisStorage`, `createPostgresStorage`) runs against —
  drift between implementations is impossible-to-not-notice.

## [0.5.0] — 2026-05-11

### Added

- **`withRateLimit(client, options?)` decorator + `TokenBucket` /
  `BucketMap` primitives.** Wraps any `WhatsAppLikeClient` and
  throttles `send*` calls at a per-pair bucket (default 1 msg per
  6 s) and a per-WABA bucket (default 80 MPS) before delegating to
  the wrapped client. Caller surface unchanged — the queue is
  invisible. Lower-level `TokenBucket` and `BucketMap` are exported
  for non-WhatsApp use cases. See [`docs/queue.md`](./docs/queue.md).
- New OTel span `whatsapp.queue.acquire` exposes queue latency
  separately from network latency, with PII-redacted recipient /
  WABA attributes.

## [0.4.0] — 2026-05-10

### Added

- **`TokenProvider` callback for `WhatsAppClient`.**
  `WhatsAppClientOptions.token` now accepts
  `string | (() => string | Promise<string>)`. The SDK resolves the
  callback once per outer request — all retries within a single
  request reuse the same resolved value. Closes the race window in
  the previous "swap the client instance per tenant on
  `AuthenticationError`" rotation pattern. The `TokenProvider` type
  is exported from the root entry. See
  [`docs/client.md`](./docs/client.md) and
  [`docs/patterns.md`](./docs/patterns.md) § 5.
- Provider errors (throw, empty string, non-string return) surface
  as `AuthenticationError` before the HTTP request is made, with
  the underlying error attached as `cause`.

### Changed

- **BREAKING (pre-1.0 minor):** the `@internal`
  `WhatsAppClient._getBearerToken(): string` is removed and replaced
  with `WhatsAppClient._resolveBearerToken(): Promise<string>`.
  External callers MUST NOT depend on internal accessors; the legacy
  helper is gone.

## [0.3.0] — 2026-05-10

### Added

- **`@dojocoding/whatsapp/hono` subpath** — typed Hono `Handler`
  wrapper around the web-standard core. Mount with
  `app.all(path, whatsappHandler(receiver))`. See
  [`docs/hono.md`](./docs/hono.md) and
  [`docs/cookbook/hono.md`](./docs/cookbook/hono.md). Hono is an
  optional peer dependency on `^4.0.0`.

## [0.2.0] — 2026-05-10

### Added

- **`@dojocoding/whatsapp/web` subpath** — Fetch-API
  (`Request → Response`) handler usable on Cloudflare Workers, Bun,
  Deno, Hono, Next.js App Router, and any WinterCG runtime. See
  [`docs/web.md`](./docs/web.md) and
  [`docs/cookbook/cloudflare-workers.md`](./docs/cookbook/cloudflare-workers.md).
- WebCrypto migration of `verifySignature`, `verifyHandshake`, and
  `hashPhoneNumberId` — these now run unmodified on any WinterCG
  runtime in addition to Node. Byte-identical output to the previous
  `node:crypto` implementations, verified by parity tests.

### Changed

- **BREAKING (pre-1.0 minor):** `verifySignature`, `computeSignature`,
  and `hashPhoneNumberId` are now `async`. Internal call sites are
  updated; external callers must `await` the return value.
- **BREAKING (pre-1.0 minor):** `WebhookReceiver.verify` and
  `WebhookReceiver.handlePayload` are now `async`. The return shape
  (`{ status, dispatchPromise }`) is unchanged; the receiver now
  resolves to it via a Promise.
- The Express adapter is now a thin shim over the web-standard core
  (`createWhatsAppHandler`). Externally observable behaviour is
  unchanged; the integration suite passes without modification.

## [0.1.0] — 2026-05-10

First public release. Eight capability slices, all proposed and merged through
OpenSpec; see `openspec/changes/archive/` for the per-capability proposal,
design, spec deltas, and tasks.

### Added

- **Cloud API client** (`WhatsAppClient`) — HTTP transport with bearer-token
  auth, exponential-backoff retry with full jitter on 408/429/5xx and Meta
  recoverable codes (130429 / 131048 / 131053 / 131056), `Retry-After`
  honouring, token-debug health check, per-instance Graph API version pin.
- **Message builders** — typed builders and `client.send*` convenience methods
  for text, image, video, audio, document, sticker, location, contacts,
  interactive (button / list / cta_url), template, reaction, and reply
  messages.
- **Webhook receiver** (`WebhookReceiver`) — GET-handshake verify-token check,
  raw-body HMAC-SHA256 signature verification with `crypto.timingSafeEqual`,
  polymorphic event parsing (`message`, `status`, `template_status`,
  `template_quality_update`, `template_category_update`,
  `phone_number_quality_update`, `account_alert`, `account_review`,
  `unknown`), `wamid` dedupe through a pluggable `Storage`, and 30-second-ack
  async dispatch.
- **24-hour window tracker** (`WindowTracker`) — pluggable `Storage`-backed
  customer-service window state; `client.send*` throws `WindowClosedError`
  pre-flight when the window is closed. Templates and reactions are
  window-exempt.
- **Template management** — list / get approved templates; 1-indexed
  contiguous `{{N}}` placeholder validation; cross-validation of template
  components against placeholder counts before send.
- **Mock mode** (`MockWhatsAppClient`, `pickWhatsAppClient`) — shared
  `WhatsAppLikeClient` interface with the real client, parity-tested across a
  cross-client matrix. Records sends in memory; optional in-memory template
  registry. No Meta credentials required.
- **Observability** — OpenTelemetry spans on every Graph API request and
  every webhook-handler invocation, with PII-redacting `hashPhoneNumberId`
  (configurable salt via `setRedactSalt`). `@opentelemetry/api` is an
  optional peer dependency.
- **Express adapter** (`@dojocoding/whatsapp/express`) — middleware that
  captures raw bytes before any JSON parser, handles `GET`/`POST` method
  routing, and acks within 30 seconds.
- **Typed error classes** — `WhatsAppError`, `RateLimitError`,
  `WindowClosedError`, `WebhookSignatureError`, `TemplateError`,
  `MissingCredentialsError`, `MockModeError`, `AuthenticationError`,
  `PermissionError`, `CapabilityError`. Branch with `instanceof`, not
  string matching.
- **Storage interface** — `Storage` with TTL semantics and `InMemoryStorage`
  reference implementation. Shared by `WindowTracker` and the webhook
  deduper.

### Compliance

- Graph API pin: `v25.0`.
- Webhook dedupe TTL: 24 hours (covers Meta's up-to-7-day delivery retries
  practically; full 7-day TTL is opt-in via `Storage` config).
- Webhook ack deadline: 30 seconds.

### Project

- Spec-driven via [OpenSpec](https://github.com/openspec-dev/openspec); eight
  stable specs under `openspec/specs/`.
- Dual ESM + CJS build via `tsup`; `Node >= 20` LTS.
- Test layers: unit, contract, integration, parity. Coverage thresholds
  enforced in CI (line ≥ 90 %, branch ≥ 85 %).
- Licensed under [MIT](./LICENSE).

[0.7.1]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.7.1
[0.7.0]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.7.0
[0.6.0]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.6.0
[0.5.0]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.5.0
[0.4.0]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.4.0
[0.3.0]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.3.0
[0.2.0]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.2.0
[0.1.0]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.1.0
