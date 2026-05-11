## 1. Type surface

- [ ] 1.1 Add `TemplateParameterLimitedTimeOffer`, `TemplateParameterCouponCode`, `TemplateParameterPayload` to `src/messages/types.ts`; widen the `TemplateParameter` union to include them.
- [ ] 1.2 Widen `TemplateComponent.type` to include `"carousel"` and `"limited_time_offer"`. Add an optional `cards?: ReadonlyArray<CarouselCardComponent>` field (only meaningful when `type === "carousel"`).
- [ ] 1.3 Add `CarouselCardComponent` interface — `{ card_index: number; components: ReadonlyArray<TemplateComponent> }`.
- [ ] 1.4 Widen `TemplateComponent.index` from `string` to `string | number` (Meta's docs use both).
- [ ] 1.5 Extend `AudioMessage.audio` with an optional `voice?: boolean` field.

## 2. Auth-template builder

- [ ] 2.1 Add `BuildAuthTemplateInput` interface — `{ to: string; name: string; language: string; otp: string; otpButtonIndex?: string | number }`.
- [ ] 2.2 Implement `buildAuthTemplate(input): TemplateMessage` in `src/messages/builders.ts`. Throws `TemplateError` when `otp.length > 15` or `otp.length === 0`.
- [ ] 2.3 In-file JSDoc references Meta's "Copy code authentication templates" doc URL.
- [ ] 2.4 Builder default for `otpButtonIndex`: `"0"` (matches Meta's documented example).
- [ ] 2.5 Re-export from `src/messages/index.ts` and `src/index.ts`.

## 3. Voice-note builder

- [ ] 3.1 Add `BuildVoiceInput` — `{ to: string; mediaId?: string; link?: string }` (exactly one of mediaId/link required).
- [ ] 3.2 Implement `buildVoice(input): AudioMessage` that produces `{ type: "audio", audio: { id|link, voice: true } }`.
- [ ] 3.3 JSDoc references Meta's "Audio messages" doc; flags that voice notes trigger transcription + auto-download + "played" read receipts.
- [ ] 3.4 Re-export.

## 4. Carousel-template builder

- [ ] 4.1 Add `BuildCarouselTemplateInput` — `{ to: string; name: string; language: string; bodyParameters?: ReadonlyArray<string>; cards: ReadonlyArray<CarouselCard> }`.
- [ ] 4.2 Add `CarouselCard` input shape — `{ header: { type: "image" | "video"; mediaId: string } | { type: "image" | "video"; link: string }; bodyParameters?: ReadonlyArray<string>; buttons?: ReadonlyArray<CarouselCardButton> }`.
- [ ] 4.3 Add `CarouselCardButton` input shape — `{ subType: "quick_reply"; payload: string } | { subType: "url"; text: string }`.
- [ ] 4.4 Implement `buildCarouselTemplate(input): TemplateMessage`. Validates `1 ≤ cards.length ≤ 10`; throws `TemplateError` otherwise.
- [ ] 4.5 Compute `card_index` from the iteration index. Consumer cannot get it wrong.
- [ ] 4.6 JSDoc references Meta's "Media card carousel templates" doc URL.
- [ ] 4.7 Re-export.

## 5. Client convenience methods

- [ ] 5.1 Add `sendAuthTemplate(input, options?): Promise<MessageSendResponse>` to `WhatsAppClient` — wraps `buildAuthTemplate` + `sendMessage`.
- [ ] 5.2 Add `sendVoice(input, options?)` — wraps `buildVoice`. Window-exempt: voice notes are still free-form so the existing window check applies (use the existing `#assertWindowOpen` helper).
- [ ] 5.3 Add `sendCarouselTemplate(input, options?)` — wraps `buildCarouselTemplate`. Window-EXEMPT (templates).
- [ ] 5.4 Mirror all three on `MockWhatsAppClient` in `src/mock/client.ts` and on the `WhatsAppLikeClient` interface in `src/mock/types.ts`.

## 6. Snapshot fixtures

- [ ] 6.1 Add `test/__fixtures__/messages/auth-template-copy-code.json` transcribed verbatim from Meta's copy-code auth template doc.
- [ ] 6.2 Add `test/__fixtures__/messages/voice-note.json` transcribed from Meta's audio messages doc.
- [ ] 6.3 Add `test/__fixtures__/messages/carousel-template.json` transcribed from Meta's media card carousel templates doc.
- [ ] 6.4 Add `test/__fixtures__/messages/lto-template.json` transcribed from Meta's limited-time-offer templates doc.

## 7. Tests

- [ ] 7.1 `test/unit/messages/auth-template.test.ts` — snapshot test of `buildAuthTemplate` output against the fixture; rejects `otp.length > 15` and empty OTP; accepts the default and custom `otpButtonIndex`.
- [ ] 7.2 `test/unit/messages/voice.test.ts` — snapshot test against the fixture; mediaId vs link variants.
- [ ] 7.3 `test/unit/messages/carousel-template.test.ts` — snapshot test; rejects 0 cards; rejects 11 cards; computes `card_index` from iteration order.
- [ ] 7.4 `test/unit/messages/lto-template.test.ts` — exercises `buildTemplate(...)` with the new `limited_time_offer` and `coupon_code` parameter types; snapshot vs fixture.
- [ ] 7.5 `test/contract/message-builders/auth-template-send.test.ts` — `client.sendAuthTemplate(...)` produces the captured HTTP body. Same for voice + carousel.
- [ ] 7.6 `test/parity/send-parity.test.ts` — extend the cross-client matrix to cover `sendAuthTemplate`, `sendVoice`, `sendCarouselTemplate` against both real and mock clients.

## 8. Documentation

- [ ] 8.1 `docs/messages.md` — three new sections (auth template, voice note, carousel template) with example payloads and the Meta doc URL.
- [ ] 8.2 `docs/templates.md` — one new section for LTO with the `limited_time_offer` + `coupon_code` parameter shapes.
- [ ] 8.3 `docs/compatibility.md` — update the comparison table (the four "less ergonomically supported" rows now flip).
- [ ] 8.4 `CHANGELOG.md` `[Unreleased]` block.

## 9. Archive + release

- [ ] 9.1 `openspec validate --changes --strict` — clean.
- [ ] 9.2 Push, wait for CI green (release-discipline skill).
- [ ] 9.3 Tick checkboxes; commit.
- [ ] 9.4 `openspec archive add-message-types-2026q2 --yes`.
- [ ] 9.5 Commit the archive.
- [ ] 9.6 Bump to `0.7.0`, push, wait for CI green, tag, watch release workflow, confirm npm publish.
