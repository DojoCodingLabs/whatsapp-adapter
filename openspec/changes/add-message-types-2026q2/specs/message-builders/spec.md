## ADDED Requirements

### Requirement: buildAuthTemplate produces the documented OTP send payload

The package SHALL export `buildAuthTemplate(input): TemplateMessage` from
`@dojocoding/whatsapp`. The function SHALL produce a `TemplateMessage` whose
`components` array contains a body component carrying the OTP via a `text`
parameter AND a URL button component (default `index: "0"`) also carrying
the OTP via a `text` parameter. The same OTP value SHALL appear in both
positions. The wire shape SHALL match Meta's documented payload at
https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates/
byte-for-byte (verified via a snapshot test against a fixture transcribed
from Meta's docs).

The same wire shape applies to one-tap and zero-tap authentication
templates; the subtype distinction lives at template creation time, not at
send time.

#### Scenario: Standard OTP send payload

- **WHEN** `buildAuthTemplate({ to: "+5212345", name: "verification_code", language: "en_US", otp: "J$FpnYnP" })` is called
- **THEN** the returned `TemplateMessage.template.components` is exactly
  ```json
  [
    { "type": "body", "parameters": [{ "type": "text", "text": "J$FpnYnP" }] },
    { "type": "button", "sub_type": "url", "index": "0", "parameters": [{ "type": "text", "text": "J$FpnYnP" }] }
  ]
  ```

#### Scenario: OTP > 15 characters throws TemplateError

- **WHEN** `buildAuthTemplate({ ..., otp: "0123456789ABCDEF" })` is called (16 chars)
- **THEN** the function throws `TemplateError`
- **AND** `error.code === "TEMPLATE"`

#### Scenario: Empty OTP throws TemplateError

- **WHEN** `buildAuthTemplate({ ..., otp: "" })` is called
- **THEN** the function throws `TemplateError`

#### Scenario: Custom otpButtonIndex is honoured

- **WHEN** `buildAuthTemplate({ ..., otp: "1234", otpButtonIndex: "1" })` is called
- **THEN** the button component's `index` field is `"1"`

### Requirement: buildVoice produces an audio payload with voice:true

The package SHALL export `buildVoice(input): AudioMessage` that produces an
audio message with the `voice: true` flag set. The wire shape SHALL match
Meta's documented payload at
https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages
— `{ type: "audio", audio: { id|link, voice: true } }`. Setting
`voice: true` triggers transcription support, auto-download, and the
"played" status when the recipient listens.

#### Scenario: Voice note from media ID

- **WHEN** `buildVoice({ to: "+1", mediaId: "1013859600285441" })` is called
- **THEN** the returned message is
  ```json
  {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "+1",
    "type": "audio",
    "audio": { "id": "1013859600285441", "voice": true }
  }
  ```

#### Scenario: Voice note from public link

- **WHEN** `buildVoice({ to: "+1", link: "https://example.com/voice.ogg" })` is called
- **THEN** the `audio` field is `{ link: "https://example.com/voice.ogg", voice: true }`

#### Scenario: Neither mediaId nor link throws TemplateError

- **WHEN** `buildVoice({ to: "+1" })` is called with no media source
- **THEN** the function throws (Meta requires exactly one of `id` or `link`)

#### Scenario: AudioMessage.audio.voice is optional

- **WHEN** the existing `buildAudio({ to, mediaId })` is called (without the voice flag)
- **THEN** the returned `AudioMessage.audio` does NOT contain a `voice` field
- **AND** the message remains backward-compatible with v0.6 consumers

### Requirement: buildCarouselTemplate produces the documented carousel payload

The package SHALL export `buildCarouselTemplate(input): TemplateMessage` that
produces a template-send payload with a `type: "carousel"` component
containing 1–10 cards. The wire shape SHALL match Meta's documented
payload at
https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates/.
The builder SHALL compute each card's `card_index` from its position in the
input array (0-based, contiguous). Cards SHALL contain a required header
(image or video) and optional body parameters and buttons.

#### Scenario: Single-card carousel with image header and URL button

- **WHEN** `buildCarouselTemplate({ to, name: "promo", language: "en_US", cards: [{ header: { type: "image", mediaId: "img1" }, bodyParameters: ["NEW"], buttons: [{ subType: "url", text: "SKU123" }] }] })` is called
- **THEN** the `components` array contains a `{ type: "carousel", cards: [...] }` entry
- **AND** `cards[0].card_index === 0`
- **AND** the card's `components` array contains the documented header / body / button parameter shapes

#### Scenario: Empty cards array throws TemplateError

- **WHEN** `buildCarouselTemplate({ ..., cards: [] })` is called
- **THEN** the function throws `TemplateError`

#### Scenario: More than 10 cards throws TemplateError

- **WHEN** `buildCarouselTemplate({ ..., cards: <11 cards> })` is called
- **THEN** the function throws `TemplateError` referencing Meta's 10-card maximum

#### Scenario: card_index is computed in iteration order regardless of caller input

- **WHEN** carousel cards are provided in some order with no `card_index` field exposed in the input shape
- **THEN** the output `card_index` values are exactly `0, 1, 2, ...` in input-array order
