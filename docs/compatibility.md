# Compatibility & comparison

Where this SDK fits in the broader WhatsApp tooling landscape, and how it
compares to the alternatives. Read this if you're choosing between
libraries or arriving here from a different ecosystem.

## Where this SDK fits

`@dojocoding/whatsapp` wraps **Meta's WhatsApp Cloud API** (the
Graph-API-based business messaging service). It's a server-side SDK for
businesses with an approved WABA (WhatsApp Business Account) and a System
User or BISU bearer token.

It is **not**:

- A WhatsApp Web reverse-engineered library. Tools like
  [`whiskeysockets/Baileys`](https://github.com/WhiskeySockets/Baileys),
  [`pedroslopez/whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js),
  and [`openclaw/wacli`](https://github.com/openclaw/wacli) (built on
  `whatsmeow`) speak the multi-device pairing protocol. They're useful for
  personal automation and offline-mirroring use cases but not for compliant
  business messaging — they pair as a linked device, can be banned without
  notice, and don't support Meta's template-approval flow or 24-hour
  customer-service-window pricing.
- A telephony or Calls API client. The Calls / Voice surface is explicitly
  out of scope for v1 (see `openspec/config.yaml`).
- An "Embedded Signup" or onboarding UI. Consumers provision tokens via
  Meta Business Manager; this SDK consumes them.

If you arrived here from a Web-protocol library: the trust model and the
public API both look quite different. There is no QR pairing; sends require
a bearer token; receives require a public HTTPS endpoint and HMAC-verified
webhooks. The 24-hour customer-service window is a real, server-enforced
rule (see [`compliance.md`](./compliance.md)).

## The actively-maintained Cloud API alternatives (May 2026)

Meta's official Node SDK
[`WhatsApp/WhatsApp-Nodejs-SDK`](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK)
was archived in **June 2023**. The formerly-popular
[`tawn33y/whatsapp-cloud-api`](https://github.com/tawn33y/whatsapp-cloud-api)
was archived in **July 2024**. Neither is a current option.

The actively-maintained alternatives we benchmarked against:

| Repo                                                                              | Stars | Last release      | Style                                                                                                            |
| --------------------------------------------------------------------------------- | ----- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`Secreto31126/whatsapp-api-js`](https://github.com/Secreto31126/whatsapp-api-js) | 330   | v6.2.1 (Nov 2025) | Class-based message builders (`new Text(...)`), event emitters (`api.on.message = …`), zero deps, dual Node/Deno |
| [`great-detail/WhatsApp-JS-SDK`](https://github.com/great-detail/WhatsApp-JS-SDK) | 28    | Recent            | Multi-runtime (Node/Deno/Bun)                                                                                    |
| [`froggy1014/meta-cloud-api`](https://github.com/froggy1014/meta-cloud-api)       | 14    | Recent            | Type-safety focus                                                                                                |
| [`phoscoder/wa-cloud-api`](https://github.com/phoscoder/wa-cloud-api)             | 28    | Established       | JS-first wrapper                                                                                                 |

`whatsapp-api-js` is the closest in scope to this SDK and the most useful
comparison anchor.

## Comparison: this SDK vs `whatsapp-api-js`

| Concern                | `@dojocoding/whatsapp`                                                                                                                                                                                   | `Secreto31126/whatsapp-api-js`                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Builders               | Functional: `buildText({ to, body })` returns a wire payload                                                                                                                                             | Class: `new Text(body)` and pass to `sendMessage`                                |
| Discriminated union    | `WhatsAppMessage` union with `type` discriminator at top level                                                                                                                                           | Per-message-type classes                                                         |
| Webhook receiver       | `WebhookReceiver` class, `receiver.on("message", h)`, polymorphic event types (`message`, `status`, `template_status`, `phone_number_quality`, …)                                                        | Event-emitter style: `api.on.message = …`, fewer event kinds exposed             |
| Signature verification | Timing-safe HMAC over raw bytes, malformed-input safe (returns `false`, never throws)                                                                                                                    | HMAC verified inside `post(...)`                                                 |
| 24-hour window         | First-class `WindowTracker` primitive with pluggable `Storage`; pre-flight gate on `client.send*` so the client throws `WindowClosedError` before any HTTP call                                          | Not enforced client-side; rely on Meta's 131026                                  |
| Typed errors           | 7-class hierarchy (`WhatsAppError`, `RateLimitError`, `WindowClosedError`, `WebhookSignatureError`, `TemplateError`, `MissingCredentialsError`, `MockModeError`) with `instanceof`-safe prototype chains | Less granular                                                                    |
| Mock mode              | `MockWhatsAppClient` shares a `WhatsAppLikeClient` interface with the real client; parity-tested                                                                                                         | Tests use msw or similar                                                         |
| Retry                  | Exponential backoff + full jitter; honours `Retry-After`; retries on 408/429/5xx and Meta codes 130429/131048/131056/131053                                                                              | Less explicit                                                                    |
| Observability          | OTel `withSpan` on every Graph call and every webhook-handler invocation, with PII redaction (`hashPhoneNumberId`)                                                                                       | None built-in                                                                    |
| Framework adapter      | First-class Express sub-module (`@dojocoding/whatsapp/express`)                                                                                                                                          | Framework-agnostic helpers                                                       |
| Spec discipline        | Spec-driven via OpenSpec; every public-API change has a corresponding spec scenario                                                                                                                      | None                                                                             |
| Message-type breadth   | Text, image, video, audio, document, sticker, location, contacts, interactive (button/list/cta_url), template, reaction                                                                                  | All of the above plus voice notes, carousel cards, and more shipped through 2025 |
| Dependencies           | `zod` runtime; `@opentelemetry/api` peer-dep                                                                                                                                                             | Zero runtime dependencies                                                        |

**When `whatsapp-api-js` is the better choice for you:** you want zero
runtime dependencies, broader Meta-feature coverage (voice notes,
carousels), or a more ergonomic class-based builder API.

**When this SDK is the better choice for you:** you want strict typed
errors, a built-in 24-hour-window primitive, OTel observability out of the
box, mock parity, and a spec-first development discipline.

## Patterns we borrowed

From `whatsapp-api-js`:

- The "verify-token-as-secret" framing — keep it short, treat it as
  rotatable.
- `on(kind, handler)` registration shape.

From the archived Meta SDK:

- Pinning the Graph API version as a constructor option, not a hard-coded
  global.

From operational experience:

- Capturing raw bytes before JSON parsing (the most common cause of
  signature-verification failures across every wrapper we read).
- Treating templates and reactions as window-exempt.

## Patterns we explicitly didn't borrow

- **Single global client / module-level state** — every SDK we looked at
  trends towards this. We don't, because multi-WABA tenancy is
  unavoidable in the front-desk use case. One instance per phone number;
  zero global state.
- **Generic "any-shape" inbound events** — most libraries hand back the
  raw Meta envelope. We parse into a polymorphic `WhatsAppEvent` union so
  consumers can use TypeScript's exhaustiveness checks.
- **Throwing on missing webhook signature** — we return `false` from
  `verifySignature` and let the caller decide the HTTP status. Throwing
  obscures the difference between "couldn't verify" and "verified and
  failed".

## Migration notes

There's no automated migration path from any other library. The shapes are
different enough that you should expect to rewrite your message construction
and webhook routing. The good news: both areas are usually under 100 lines
of glue code.

If you're migrating from `tawn33y/whatsapp-cloud-api` (now archived), the
biggest mental shift is that this SDK doesn't bundle an Express server —
it ships a router for you to mount on your own app, so the webhook URL is
yours to choose.
