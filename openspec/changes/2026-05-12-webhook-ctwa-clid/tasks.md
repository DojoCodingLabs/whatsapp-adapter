## 1. Phase 1 — types + parser

- [ ] 1.1 Add the `WhatsAppReferral` interface to `packages/whatsapp-sdk/src/webhooks/events.ts` next to `MessageEvent`.
- [ ] 1.2 Add `referral?: WhatsAppReferral & Record<string, unknown>` to `MessageEvent` (typed core fields + permissive pass-through).
- [ ] 1.3 Update `packages/whatsapp-sdk/src/webhooks/parser.ts` `parseMessageEntry` (or equivalent) to preserve `messages[i].referral` onto the emitted event when present. Empty `{}` is preserved.
- [ ] 1.4 Confirm the existing parser tests still pass — no behaviour change for non-CTWA payloads.

## 2. Phase 2 — fixtures + tests

- [ ] 2.1 Add fixture `packages/whatsapp-sdk/test/__fixtures__/webhooks/message-with-ctwa-referral.json` containing a full sanitised CTWA payload (every documented field).
- [ ] 2.2 Add fixture `packages/whatsapp-sdk/test/__fixtures__/webhooks/message-with-empty-referral.json` (`referral: {}`).
- [ ] 2.3 Add unit tests under `packages/whatsapp-sdk/test/unit/webhooks/parser-ctwa.test.ts`:
  - Full CTWA payload → parsed event carries every documented field byte-identically.
  - Empty `referral` → `event.referral` is `{}` (not undefined).
  - Message without `referral` → `event.referral` is `undefined`.
  - Unknown extra field inside `referral` (e.g. `referral.future_field: "x"`) is preserved at runtime even though the TypeScript type doesn't name it.
- [ ] 2.4 Add a property-style test that random JSON shapes under `referral` don't make the parser throw.

## 3. Phase 3 — docs

- [ ] 3.1 Update `docs/sdk/webhooks.md` § "Inbound message events" with a "Referral / CTWA" subsection.
- [ ] 3.2 Include a minimal CAPI-handoff snippet (10 lines) showing how to forward `event.referral.ctwa_clid` to Meta CAPI.
- [ ] 3.3 Note the "first message only" attribution semantics in the doc.

## 4. Phase 4 — ship `sdk-v0.9.0` (bundled with A2 + A4)

- [ ] 4.1 Land the change on `main`.
- [ ] 4.2 Archive: `openspec archive 2026-05-12-webhook-ctwa-clid`.
