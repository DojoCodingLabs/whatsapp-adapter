## Why

The comparison doc (`docs/compatibility.md`) lists four send-able
WhatsApp message types this SDK supports less ergonomically (or not
at all) versus the actively-maintained reference SDK,
`Secreto31126/whatsapp-api-js`:

- **Authentication template (OTP)** — the most common transactional
  shape there is. Doable today via `buildTemplate({ name, language,
  components: [...] })` if the consumer hand-writes the body +
  button components and remembers that the OTP must appear in BOTH
  of them. Easy to get wrong; one missing button parameter and the
  send 400s with a useless error.
- **Voice notes** — `buildAudio` exists but the `voice: true` flag
  isn't surfaced. Users sending "WhatsApp voice notes" today get a
  regular audio file with the music-player UI instead of the
  push-to-talk PTT bubble.
- **Carousel templates** (Meta GA late 2024) — currently
  unrepresented in the `TemplateComponent` type. A consumer wanting
  to send one has to bypass the typed component shape entirely.
- **LTO (limited-time-offer) template buttons** — same story; the
  `limited_time_offer` component type and the `coupon_code`
  parameter type are not part of the `TemplateParameter` union.

This change adds dedicated builders + types for all four, with
every implementation decision grounded in Meta's official docs
(URLs included in design.md and in source-file JSDoc).

## What Changes

- **NEW** `buildAuthTemplate({ to, name, language, otp, otpButtonIndex?, security?, expiration? })`
  in `src/messages/builders.ts`. Returns a `TemplateMessage` whose
  body parameters and URL-button parameters BOTH carry the OTP
  (matches Meta's documented payload). Pre-flight validates the
  OTP code length per Meta's 15-char ceiling.
- **NEW** `buildVoice({ to, mediaIdOrLink })` convenience builder
  that wraps the existing audio path with `voice: true`.
- **NEW** `buildCarouselTemplate({ to, name, language, body?, cards })`
  + a `CarouselCard` type carrying per-card header/body/button
  parameters. Card count bounded to Meta's 10-card maximum.
- **NEW** `TemplateParameterLimitedTimeOffer` and
  `TemplateParameterCouponCode` variants on the
  `TemplateParameter` union. New `sub_type` literal `"copy_code"`
  on the `TemplateComponent.sub_type` union (already there in code
  but tightened).
- **NEW** convenience methods on `WhatsAppClient` / `MockWhatsAppClient`:
  `sendAuthTemplate`, `sendVoice`, `sendCarouselTemplate`. The LTO
  / coupon-code shape is exposed via the existing `sendTemplate`
  path because LTO templates are still template sends; the
  `limited_time_offer` component is just a new top-level component
  the caller can include.
- **NEW** snapshot tests pinning each builder's wire payload byte-for-byte
  against the Meta-documented examples.
- **NEW** parity tests against `MockWhatsAppClient` for each new
  send method.
- **MODIFIED** `docs/messages.md` and `docs/templates.md` to document
  the four new shapes with example payloads and Meta doc references.
- **MODIFIED** `CHANGELOG.md` `[Unreleased]` (becomes `[0.7.0]`).

## Capabilities

### Modified Capabilities

- `message-builders`: + 3 new requirements (auth-template builder,
  voice-note builder, carousel-template builder) + 1 modified
  requirement on the existing audio builder mentioning the new
  voice variant.
- `template-management`: + 2 new requirements covering the
  `limited_time_offer` component and the `coupon_code` parameter
  type, plus updated placeholder-validation behaviour for the
  carousel case (each card has its own placeholder count).

### New Capabilities

None — all four additions slot into the existing
`message-builders` and `template-management` capabilities.

## Non-goals

- **Catalog product templates** (single-product or multi-product
  message types). Distinct surface; deferred. Note: the carousel
  shape supports `CatalogProduct` headers but we only ship the
  image/video header variants in this change to keep the surface
  narrow.
- **Webhook event types** for carousel button clicks / LTO clicks
  / OTP autofill. The webhook parser is generous (`body:
  Record<string, unknown>` on `MessageEvent`) — these payloads
  already pass through. A dedicated typed event surface for them
  is a follow-up.
- **Authentication template creation** (via `POST
  /{waba}/message_templates`). This change is about SENDING, not
  AUTHORING. Template authoring stays in Meta Business Manager
  (see `docs/compliance.md` § "Out of scope").
- **One-tap supported-app metadata** (`package_name`,
  `signature_hash`). Those configure the template AT CREATION
  TIME, not at send time. Out of scope for this change.

## Impact

- Public API: pure addition. Existing callers unchanged.
- Bundle size: +~2 KB CJS for the four builders combined.
- Runtime: no overhead vs the existing `buildTemplate` path.
- Wire compatibility: every builder produces the exact JSON shape
  Meta's official docs document — `docs/messages.md` will quote
  the doc URL next to each example so any future Meta drift is
  obvious to spot.
