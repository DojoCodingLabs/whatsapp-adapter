## 1. Storage subsystem

- [x] 1.1 Add `WEBHOOK_DEDUPE_TTL_MS = 60 * 60 * 1000` to `src/types/constants.ts` and re-export from `src/index.ts`.
- [x] 1.2 Create `src/storage/index.ts` exporting the `Storage` interface and `InMemoryStorage` class with lazy TTL eviction. Includes `setIfAbsent` for atomic dedupe.
- [x] 1.3 Add `test/unit/storage/in-memory-storage.test.ts` covering: get/set/delete; TTL expiry (vi.useFakeTimers); idempotent delete; ttlMs=0 stores forever; lazy eviction; now injection. (7 cases)

## 2. Signature verification

- [x] 2.1 Create `src/webhooks/signature.ts` exporting `verifySignature({ rawBody, signatureHeader, appSecret })`. Strip optional `sha256=` prefix; normalise hex case; timing-safe compare; tolerate Buffer | Uint8Array | string. Also exports `computeSignature` for fixture generation.
- [x] 2.2 Add `test/unit/webhooks/signature.test.ts` covering the 4 spec scenarios + an HMAC fuzz test (200 random body × random sig pairings; verify true iff HMAC matches). (11 cases)

## 3. Verify-token handshake

- [x] 3.1 Create `src/webhooks/handshake.ts` exporting `verifyHandshake({ mode, verifyToken, challenge, expectedToken })`. Constant-time string compare on the token.
- [x] 3.2 Add `test/unit/webhooks/handshake.test.ts` covering 6 scenarios.

## 4. Polymorphic event types + parser

- [x] 4.1 Create `src/webhooks/events.ts` defining the discriminated union `WhatsAppEvent` over kinds: `message`, `status`, `template_status`, `template_quality`, `template_category`, `phone_number_quality`, `account_alert`, `account_review`, `unknown`. Each carries `wabaId`, `phoneNumberId?`, `displayPhoneNumber?`, `timestamp` (ms epoch).
- [x] 4.2 Create `src/webhooks/parser.ts` exporting `parseWebhookPayload(body) → ReadonlyArray<WhatsAppEvent>`. Pure; tolerates malformed envelope; surfaces unknown `field`s as `kind: "unknown"`.
- [x] 4.3 Add captured Meta payload fixtures under `test/__fixtures__/webhooks/` (text-inbound, button-reply, list-reply, status-sent, status-failed, template-status-approved, phone-quality-update, two-messages, unknown-field).
- [x] 4.4 Add `test/unit/webhooks/parser.test.ts` round-tripping each fixture through the parser and asserting the parsed event shape, plus per-branch coverage tests for template_quality, template_category, account_alert, account_review_update, baseTimestamp fallback, ms-epoch timestamps, unknown interactive sub-types, unknown message types. (18 cases)

## 5. Dedupe

- [x] 5.1 Create `src/webhooks/dedupe.ts` exporting `WebhookDeduper(storage, ttlMs?)`. `markIfNew(eventKey)` is async (Storage is async). Backed by atomic `setIfAbsent`.
- [x] 5.2 Add `test/unit/webhooks/dedupe.test.ts` with `vi.useFakeTimers()`. (4 cases)

## 6. WebhookReceiver

- [x] 6.1 Create `src/webhooks/receiver.ts` exporting `WebhookReceiver`. Constructor `{ appSecret, verifyToken, storage?, dedupeTtlMs?, onError? }`. Methods: `.on()`, `.off()`, `.verify()`, `.handleVerifyRequest()`, `.handlePayload()`, `_dispatchEvents()` (@internal).
- [x] 6.2 `.handlePayload` synchronously verifies + parses + filters dedupes + builds the `dispatchPromise`.
- [x] 6.3 Handler errors fire the `error` event AND are reported via `onError` constructor hook. dispatchPromise resolves once all handlers settle (Promise.allSettled).
- [x] 6.4 Add `test/unit/webhooks/receiver.test.ts` covering: handler invocation per kind; dedupe skip; status transitions are NOT collapsed; bad signature → 401, no handler; handler error fires `error` event + onError; `off()` unregisters; `_dispatchEvents` synthetic injection. (10 cases)

## 7. Public surface

- [x] 7.1 `src/webhooks/index.ts` re-exports verify*, parser, events types, dedupe, receiver, plus `Storage` and `InMemoryStorage` from `src/storage/`.
- [x] 7.2 `src/index.ts` re-exports the entire webhook surface and the `WEBHOOK_DEDUPE_TTL_MS` constant.

## 8. Verification

- [x] 8.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [x] 8.2 `pnpm test:coverage` — 195/195 tests pass; 97.09% lines / 85.58% branches (gates 90/85).
- [x] 8.3 `pnpm build` — all new exports present in `dist/index.d.ts`.
- [x] 8.4 `openspec validate add-webhook-receiver --strict` passes.
