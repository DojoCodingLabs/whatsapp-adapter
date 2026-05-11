## ADDED Requirements

### Requirement: TemplateParameter union includes limited_time_offer, coupon_code, and payload variants

The exported `TemplateParameter` discriminated union SHALL include three
new variants in addition to the existing text/currency/date_time/image/video/document
variants, matching Meta's documented send-payload shapes:

```ts
interface TemplateParameterLimitedTimeOffer {
  type: "limited_time_offer";
  limited_time_offer: { expiration_time_ms: number };
}

interface TemplateParameterCouponCode {
  type: "coupon_code";
  coupon_code: string;
}

interface TemplateParameterPayload {
  type: "payload";
  payload: string;
}
```

Source: Meta's limited-time-offer template send payload documents the
`limited_time_offer.expiration_time_ms` parameter shape, and the
`coupon_code` button parameter shape, at
https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/limited-time-offer-templates/.
Meta's carousel template send payload documents the `payload` parameter
shape for `quick_reply` buttons at
https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates/.

#### Scenario: LTO + coupon code via buildTemplate

- **WHEN** the consumer assembles an LTO template send via `buildTemplate({ ..., components: [{ type: "limited_time_offer", parameters: [{ type: "limited_time_offer", limited_time_offer: { expiration_time_ms: 1209600000 } }] }, { type: "button", sub_type: "copy_code", index: 0, parameters: [{ type: "coupon_code", coupon_code: "CARIBE25" }] }] })`
- **THEN** the function returns a `TemplateMessage` whose `components` array preserves the input verbatim
- **AND** the wire payload matches Meta's documented LTO send example byte-for-byte

#### Scenario: payload parameter for carousel quick_reply button

- **WHEN** a carousel card includes a quick_reply button via `buildCarouselTemplate(...)` with `{ subType: "quick_reply", payload: "SEE_MORE" }`
- **THEN** the rendered card-level component contains `{ type: "button", sub_type: "quick_reply", index: 0, parameters: [{ type: "payload", payload: "SEE_MORE" }] }`

### Requirement: TemplateComponent type widens to include carousel and limited_time_offer

The `TemplateComponent.type` discriminator SHALL accept `"carousel"` and `"limited_time_offer"` in addition to the existing `"header" | "body" | "button" | "footer"` values. The `sub_type` field SHALL accept `"copy_code"` (already in the union). The `index` field SHALL accept either a string or a number (Meta's docs use both).

A `TemplateComponent` with `type === "carousel"` SHALL carry a `cards: ReadonlyArray<CarouselCardComponent>` field where each card has `{ card_index: number; components: ReadonlyArray<TemplateComponent> }`.

#### Scenario: Carousel component shape

- **WHEN** a `TemplateComponent` with `type: "carousel"` is produced by `buildCarouselTemplate(...)`
- **THEN** it carries a `cards` field and NO `parameters` field
- **AND** each card's `components` is a regular `ReadonlyArray<TemplateComponent>` containing per-card header / body / button shapes

#### Scenario: limited_time_offer component shape

- **WHEN** a `TemplateComponent` with `type: "limited_time_offer"` is produced
- **THEN** it carries a `parameters` field with exactly one `TemplateParameterLimitedTimeOffer` entry
- **AND** the entry's `limited_time_offer.expiration_time_ms` is a positive finite integer (Unix milliseconds since epoch)

### Requirement: Placeholder validation respects per-card carousel scope

`validateTemplateSend` SHALL treat each carousel card as an independent placeholder scope. The body and button placeholders on card 0 SHALL NOT be aggregated with those of card 1; each card's component list is validated against the corresponding card definition in the approved template.

The implementation SHALL fall back to a permissive check (no error) when the carousel template's definition is not present in the local template registry — consistent with the existing `validateTemplateSend` behaviour for templates not yet listed.

#### Scenario: Mismatched card body parameters across multiple cards

- **WHEN** a 3-card carousel send is built and only card 0 supplies `bodyParameters`
- **THEN** `validateTemplateSend` checks each card's body component count against its own template-definition expectation
- **AND** card 0 passing while cards 1–2 fail produces a `TemplateError` naming the failing card index
