## 1. Types and parser

- [x] 1.1 `MessageEvent` gains `fromUserId`, `fromParentUserId`, `contact`, `groupId`, `errors`; `from` JSDoc documents `""`.
- [x] 1.2 Contact join (wa_id → user_id → single contact of a single-item batch).
- [x] 1.3 `IncomingMessageKind` + `interactive_product`, `edit`, `revoke`; `request_welcome` deprecated.
- [x] 1.4 `WhatsAppReferral` + `image_url`, `video_url`, `welcome_message.text`; legacy keys deprecated.
- [x] 1.5 `WebhookErrorEvent` for `value.errors`; `EventKindMap.webhook_error`.
- [x] 1.6 `StatusEvent` recipient BSUID / group / identity / `bizOpaqueCallbackData` / `pricingSubtype` / `contact`; typed `errors`; pricing JSDoc refreshed.
- [x] 1.7 `UserPreferencesEvent` `userId` / `parentUserId`.

## 2. Accessors

- [x] 2.1 `messageSenderKey`, `messageText`, `messageReplyId`, `messageMedia`, `messageReferral`, `messageIdentityChange` in `src/webhooks/accessors.ts`, exported from the root.

## 3. Receiver

- [x] 3.1 `user_preferences` dedupe identity falls back to `bsuid:<userId>`.
- [x] 3.2 `WEBHOOK_DEDUPE_TTL_MS` = 7 days.
- [x] 3.3 `whatsapp.event.id` hashed with the receiver salt.

## 4. Agent bridge

- [x] 4.1 `conversationId` and window-tracker keys use `messageSenderKey`; `AgentTask.fromUserId`.

## 5. Tests

- [x] 5.1 Meta doc payload fixtures (BSUID, parent BSUID, system rotation, CTWA, voice audio, button/list reply, product, template button, statuses).
- [x] 5.2 Unit: `parser-identity.test.ts`, `accessors.test.ts`, `receiver-identity.test.ts` (incl. same-second BSUID opt-out collision, webhook_error, 7-day TTL).
- [x] 5.3 Contract: span hashing (+ salt), agent-bridge BSUID keys, public surface.
- [x] 5.4 Parity: `simulateInbound` vs `handlePayload` on the BSUID fixtures.

## 6. Docs

- [x] 6.1 `docs/sdk/webhooks.md`, `docs/sdk/agent-bridge.md`, `docs/sdk/observability.md`, `docs/compliance.md` § 2 and § 3.2, `CHANGELOG.md`.
