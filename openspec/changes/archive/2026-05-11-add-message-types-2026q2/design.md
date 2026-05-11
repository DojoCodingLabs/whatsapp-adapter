## Context

The four message types in scope are all valid `POST
/{phoneNumberId}/messages` shapes that consumers can send today via
the lower-level `buildTemplate` or `buildAudio` paths — but doing so
requires consumers to know each shape's idiosyncrasies. The
auth-template OTP appearing in BOTH body and button parameters is
the canonical example: get it wrong (OTP in body only, no button
parameter) and Meta rejects the send with a generic 400.

This change adds first-class typed builders for each, with every
field name and wire shape grounded in a Meta doc URL recorded in
source-file JSDoc and in `design.md` below.

### Authoritative sources (verified 2026-05-11)

- Copy-code authentication template send payload:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates/
- One-tap autofill authentication template (same send-time wire
  shape; difference is at template creation):
  https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/one-tap-autofill-authentication-templates/
- Zero-tap authentication template:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/zero-tap-authentication-templates/
- Media card carousel templates (send payload):
  https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates/
- Limited-time-offer templates (send payload):
  https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/limited-time-offer-templates/
- Audio messages (the `voice: true` flag):
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages

Domain rules from `openspec/config.yaml` this design must satisfy:

- **Template variables `{{N}}` are 1-INDEXED and contiguous.** The
  carousel builder must keep per-card placeholder math separate —
  each card has its own placeholder count, and the cross-validation
  in `template-management` needs to know about that.
- **`waba_id` ≠ `phone_number_id`.** Carousel and LTO templates are
  authored against a WABA but sent from a phone-number-id; the
  builders take only the recipient `to` and the template name — the
  send target comes from the client.
- **No `any` in public types.** The new
  `TemplateParameterLimitedTimeOffer` and
  `TemplateParameterCouponCode` slot into the existing
  `TemplateParameter` discriminated union with explicit `type`
  discriminators.

## Goals / Non-Goals

**Goals:**

- `buildAuthTemplate(input): TemplateMessage` — produces the
  documented copy-code/one-tap/zero-tap payload. Works for ALL
  three subtypes because the send-time wire shape is identical;
  the subtype distinction lives at template creation time.
- `buildVoice(input): AudioMessage` — same audio shape with the
  `voice: true` flag set.
- `buildCarouselTemplate(input): TemplateMessage` — typed
  `CarouselCard[]` input mapping cleanly to the documented
  `card_index` + per-card components array.
- LTO + coupon-code parameter types added to the
  `TemplateParameter` union so `buildTemplate({ components: [...] })`
  can produce LTO sends with full type safety.
- Snapshot tests pin each builder's wire payload byte-for-byte
  against the Meta doc example.

**Non-Goals:**

- Convenience builder for LTO sends. The shape is a regular
  template send with an LTO component in the components array;
  exposing it as a one-liner adds little over `buildTemplate(...)`.
- Catalog-product carousel cards. The Meta shape exists but is
  rarely used; out of scope.
- Validation of OTP code format (digits-only, length). Meta's
  template definition controls what's accepted; we cap at 15 chars
  per Meta's documented max and otherwise leave it to the
  template's regex.
- Webhook-side typed events for new button click types. The
  receiver already exposes `body: Record<string, unknown>` on
  `MessageEvent` — these payloads pass through.

## Decisions

### Decision: `buildAuthTemplate` accepts a single `otp` field, fills both body and button parameters

**Rationale.** Meta's documented payload has the SAME OTP code
appear in both the body component's parameter AND the URL button
component's parameter. Forcing consumers to remember to pass it
twice is exactly the kind of footgun this builder exists to remove.
One input field, two output positions.

**Alternatives considered.** A two-field shape (`bodyOtp` +
`buttonOtp`) — pointless flexibility; nobody wants them different.

### Decision: `buildAuthTemplate` does not take an `otpType` argument

**Rationale.** The send-time wire shape is identical for copy-code,
one-tap, and zero-tap. The distinction is at template creation
time (in Meta Business Manager / the templates API). The builder
needs to produce a valid payload regardless of which subtype the
template was authored as. Taking an `otpType` argument would imply
it changes the output — it doesn't.

A future spike can add zero-tap-specific helpers if the wire shape
ever diverges (Meta has stated it doesn't, as of v25).

### Decision: `buildVoice` is a thin wrapper, not a new top-level message type

**Rationale.** Meta's audio payload differs only by an extra
`voice: true` field. Adding a `VoiceMessage` to the
`WhatsAppMessage` union would create two type variants with
identical structure — wrong shape. `buildVoice` returns
`AudioMessage` with `voice: true`; the discriminated union stays
clean.

`AudioMessage`'s `audio` field type widens slightly to include the
optional `voice` boolean. Backward-compatible — existing
`audio: { id }` consumers stay valid.

### Decision: `CarouselCard` is a discriminated input, not a freeform component list

**Rationale.** Each carousel card has a fixed shape per Meta's
docs: required header (image / video media), optional body,
optional buttons. Forcing consumers to assemble the components
array by hand reintroduces the off-by-one footgun (the auth
template's twin OTP) for the per-card body parameters.

```ts
interface CarouselCard {
  header: { type: "image" | "video"; mediaId: string } | { type: "image" | "video"; link: string };
  bodyParameters?: ReadonlyArray<string>;
  buttons?: ReadonlyArray<CarouselCardButton>;
}
```

The `card_index` is computed by the builder, not the caller.
Consumers can't get the index wrong.

### Decision: LTO is a new `TemplateParameter` variant, not a top-level builder

**Rationale.** LTO templates are regular template sends; the only
new thing is one extra component shape (`limited_time_offer`) and
one extra parameter type (`coupon_code`). Exposing these as
additions to the existing `TemplateParameter` union lets
consumers use `buildTemplate({ components: [...] })` with full
type safety. A dedicated `buildLtoTemplate` builder adds API
surface for marginal ergonomic gain over `buildTemplate({
components: [{ type: "limited_time_offer", parameters: [...] },
{ type: "button", sub_type: "copy_code", index: 0, parameters: [{
type: "coupon_code", coupon_code: "..." }] }] })`.

If consumers ask for the convenience wrapper, we add it later.

### Decision: snapshot-test the wire payload byte-for-byte

**Rationale.** Each builder's output is compared against a JSON
fixture transcribed verbatim from Meta's docs (with placeholders
filled in). If Meta changes the field name (e.g.
`limited_time_offer` → `lto`), the snapshot test breaks; if our
builder drifts (forgets the button parameter), the snapshot test
breaks. Either failure mode surfaces immediately.

The fixtures live under `test/__fixtures__/messages/` so a
reviewer can diff them against the doc URLs noted in source.

### Decision: index is a string ("0") for auth-template button, a number (0) for carousel

**Rationale.** This is genuinely how Meta's docs render the
examples — string for auth, number for carousel. Both work at the
API; we mirror what Meta publishes so reviewers can compare without
mental conversion. The `TemplateComponent.index?: string | number`
type is widened minimally to allow both.

## Type-surface deltas

```ts
// New: src/messages/types.ts

export interface TemplateParameterLimitedTimeOffer {
  type: "limited_time_offer";
  limited_time_offer: { expiration_time_ms: number };
}

export interface TemplateParameterCouponCode {
  type: "coupon_code";
  coupon_code: string;
}

export interface TemplateParameterPayload {
  type: "payload";
  payload: string;
}

// Extended in src/messages/types.ts
export type TemplateParameter =
  | TemplateParameterText
  | TemplateParameterCurrency
  | TemplateParameterDateTime
  | TemplateParameterImage
  | TemplateParameterVideo
  | TemplateParameterDocument
  | TemplateParameterLimitedTimeOffer  // NEW
  | TemplateParameterCouponCode         // NEW
  | TemplateParameterPayload;           // NEW (for carousel quick_reply buttons)

// Updated: sub_type widens, type widens
export interface TemplateComponent {
  type: "header" | "body" | "button" | "footer" | "carousel" | "limited_time_offer";
  sub_type?: "quick_reply" | "url" | "copy_code";
  index?: string | number;
  parameters?: ReadonlyArray<TemplateParameter>;
  cards?: ReadonlyArray<CarouselCardComponent>; // only for type: "carousel"
}

export interface CarouselCardComponent {
  card_index: number;
  components: ReadonlyArray<TemplateComponent>;
}

// Updated: AudioMessage.audio gains an optional voice flag
export interface AudioMessage extends BaseMessage {
  type: "audio";
  audio: Pick<MediaSource, "id" | "link"> & { voice?: boolean };
}
```

## Control flow per new builder

```
buildAuthTemplate({ to, name, language, otp })
  │
  ▼
validate otp ≤ 15 chars
  │
  ▼
emit TemplateMessage with components:
  [
    { type: "body",   parameters: [{ type: "text", text: otp }] },
    { type: "button", sub_type: "url", index: "0",
      parameters: [{ type: "text", text: otp }] },
  ]
```

```
buildVoice({ to, mediaIdOrLink })
  │
  ▼
emit AudioMessage with audio: {
    [id or link]: mediaIdOrLink,
    voice: true,
  }
```

```
buildCarouselTemplate({ to, name, language, body?, cards })
  │
  ▼
validate 1 ≤ cards.length ≤ 10
  │
  ▼
emit TemplateMessage with components: [
    (optional) { type: "body", parameters: [bodyParameters...] },
    { type: "carousel", cards: cards.map((c, i) => ({
        card_index: i,
        components: [
          { type: "header", parameters: [headerFor(c.header)] },
          ...(c.bodyParameters ? [{ type: "body", parameters: ... }] : []),
          ...buttonsToComponents(c.buttons),
        ],
      })),
    },
  ]
```

## Risks

- **Meta drift.** Field names change. Snapshot tests catch this on
  the next CI run; fixing the builder is a one-line change.
- **OTP secret in logs.** The OTP appears in two places in the
  outbound payload. The SDK already redacts span attributes to
  hashes; outbound bodies are NEVER logged by the SDK. Consumers
  who log their own outbound bodies must redact.
- **Carousel card limit.** Meta enforces ≤ 10 cards. We enforce
  the same cap at build time so a 11-card send fails before HTTP
  with a clear message rather than after with a generic 400.
- **OTP length.** Meta documents a 15-char ceiling on the body
  parameter (the OTP itself). We validate; > 15 throws
  `TemplateError` at build time.

## Test layers

- **Unit (snapshot)**: each builder produces the byte-for-byte
  documented wire payload. Fixtures sourced from the URLs in
  `## Authoritative sources` above.
- **Unit (validation)**: out-of-bounds inputs throw `TemplateError`
  with informative messages (auth OTP > 15 chars; carousel > 10
  cards; carousel cards.length === 0).
- **Contract**: send methods on `WhatsAppClient` produce the same
  payload over a captured MSW handler. Asserts the HTTP body
  matches the snapshot.
- **Parity**: each new send method works against
  `MockWhatsAppClient` and records the send.
