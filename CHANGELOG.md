# Changelog

All notable changes to `@dojocoding/whatsapp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0 minor versions may contain breaking changes — see
[`CONTRIBUTING.md`](./CONTRIBUTING.md) § Releases.

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

[0.4.0]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.4.0
[0.3.0]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.3.0
[0.2.0]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.2.0
[0.1.0]: https://github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/v0.1.0
