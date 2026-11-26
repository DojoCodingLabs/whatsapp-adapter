## 1. Text helpers

- [x] 1.1 `src/reply/text.ts`: `splitText` (code-point safe, paragraph → line → sentence → space in the last half), `clipText`, `toWhatsAppText`.
- [x] 1.2 Tests `test/unit/reply/text.test.ts` (Doji parity: 4096 cuts, emoji, no loss, break preference, `max` RangeError).

## 2. Tolerant interactive builders

- [x] 2.1 `src/reply/interactive.ts`: `Reply` union, `toInteractiveReply` (clip from `MESSAGE_LENGTH_LIMITS`, dedupe, cap 3 / 10, section title), `replyAsText`, `interactiveBodyLimit` (reads `listBody` when present).
- [x] 2.2 Tests `test/unit/reply/interactive.test.ts`: every output passes `buildInteractive`; negative test — nothing usable left still throws `WhatsAppError`.

## 3. deliverReply

- [x] 3.1 `src/reply/deliver.ts`: `deliverReply`, `ReplyClient`, `isInteractiveFallbackError`, `DEFAULT_CONTINUATION_BODY`.
- [x] 3.2 Contract tests `test/contract/reply/deliver-reply.test.ts` (msw): split, long body + continuation, fallback on code 100 / 131009 / builder refusal, mock parity.
- [x] 3.3 Negative tests: `WindowClosedError` (Meta 131047 and window tracker), `OptOutError`, `AuthenticationError`, `RateLimitError` propagate with no text sent.

## 4. Window + opt-out

- [x] 4.1 `src/reply/window.ts`: `outboundMode`, `WINDOW_MARGIN_MS`.
- [x] 4.2 `src/reply/opt-out.ts`: `detectOptOut`, `OPT_OUT_MAX_LENGTH`.
- [x] 4.3 Tests `test/unit/reply/window.test.ts`, `test/unit/reply/opt-out.test.ts` (Doji parity).

## 5. Web adapter

- [x] 5.1 `verifyAndParseWebhook` in `src/adapters/web/index.ts`.
- [x] 5.2 `createWhatsAppHandler`: 400 for a signed non-JSON body; 401 when unsigned.
- [x] 5.3 Contract tests `test/contract/adapters/web/verify-and-parse.test.ts`, `non-json-body.test.ts`.

## 6. Surface + docs

- [x] 6.1 Export from `src/reply/index.ts` and `src/index.ts`; extend `test/contract/public-surface.test.ts`.
- [x] 6.2 `docs/sdk/reply.md` (with eve example), `docs/sdk/web.md`, `docs/README.md`, CHANGELOG.
