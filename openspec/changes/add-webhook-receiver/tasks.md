## 1. Storage subsystem

- [ ] 1.1 Add `WEBHOOK_DEDUPE_TTL_MS = 60 * 60 * 1000` to `src/types/constants.ts` and re-export from `src/index.ts`.
- [ ] 1.2 Create `src/storage/index.ts` exporting the `Storage` interface and `InMemoryStorage` class with lazy TTL eviction.
- [ ] 1.3 Add `test/unit/storage/in-memory-storage.test.ts` covering: get/set/delete; TTL expiry (vi.useFakeTimers); idempotent delete; ttlMs=0 stores forever (or as a sentinel).

## 2. Signature verification

- [ ] 2.1 Create `src/webhooks/signature.ts` exporting `verifySignature({ rawBody, signatureHeader, appSecret })`. Strip optional `sha256=` prefix; normalise hex case; timing-safe compare; tolerate Buffer | Uint8Array | string.
- [ ] 2.2 Add `test/unit/webhooks/signature.test.ts` covering the 4 spec scenarios + an HMAC fuzz test (200 random body × random sig pairings; verify true iff HMAC matches).

## 3. Verify-token handshake

- [ ] 3.1 Create `src/webhooks/handshake.ts` exporting `verifyHandshake({ mode, verifyToken, challenge, expectedToken })`. Constant-time string compare on the token.
- [ ] 3.2 Add `test/unit/webhooks/handshake.test.ts` covering 3 scenarios (valid → echo; wrong token; wrong mode) plus undefined inputs.

## 4. Polymorphic event types + parser

- [ ] 4.1 Create `src/webhooks/events.ts` defining the discriminated union `WhatsAppEvent` over kinds: `message`, `status`, `template_status`, `template_quality`, `template_category`, `phone_number_quality`, `account_alert`, `account_review`, `unknown`. Each carries `wabaId`, `phoneNumberId?`, `displayPhoneNumber?`, `timestamp` (ms epoch).
- [ ] 4.2 Create `src/webhooks/parser.ts` exporting `parseWebhookPayload(body) → ReadonlyArray<WhatsAppEvent>`. Pure; tolerates malformed envelope; surfaces unknown `field`s as `kind: "unknown"`.
- [ ] 4.3 Add captured Meta payload fixtures under `test/__fixtures__/webhooks/` (text-inbound, image-inbound, button-reply, list-reply, status-sent, status-delivered, status-read, status-failed, template-status-approved, template-status-rejected, phone-quality-update, account-alert, unknown-field).
- [ ] 4.4 Add `test/unit/webhooks/parser.test.ts` round-tripping each fixture through the parser and asserting the parsed event shape.

## 5. Dedupe

- [ ] 5.1 Create `src/webhooks/dedupe.ts` exporting `WebhookDeduper(storage, ttlMs?)`. `markIfNew(eventKey)` is async (Storage is async).
- [ ] 5.2 Add `test/unit/webhooks/dedupe.test.ts` with `vi.useFakeTimers()`: first sighting new; second within TTL duplicate; sighting after TTL is new again.

## 6. WebhookReceiver

- [ ] 6.1 Create `src/webhooks/receiver.ts` exporting `WebhookReceiver`. Constructor `{ appSecret, verifyToken, storage?, dedupeTtlMs?, onError? }`. Methods: `.on()`, `.handleVerifyRequest()`, `.handlePayload()`, `_dispatchEvents()` (@internal).
- [ ] 6.2 `.handlePayload` synchronously verifies + parses + filters dedupes + builds the `dispatchPromise` (which resolves once all handlers complete or fail).
- [ ] 6.3 Handler errors fire the `error` event AND are reported via `onError` constructor hook AND surface as a rejection value attached to the dispatchPromise (the promise still resolves so consumers can await without rethrows).
- [ ] 6.4 Add `test/unit/webhooks/receiver.test.ts` covering: handler invocation per kind; dedupe skip; bad signature → 401, no handler; handler error fires `error` event; verifyHandshake delegation.

## 7. Public surface

- [ ] 7.1 `src/webhooks/index.ts` re-exports verify*, parser, events types, dedupe, receiver, plus `Storage` and `InMemoryStorage` from `src/storage/`.
- [ ] 7.2 `src/index.ts` re-exports the receiver surface (not the dedupe internals; those stay reachable via the receiver's storage option).

## 8. Verification

- [ ] 8.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean
- [ ] 8.2 `pnpm test:coverage` — gates honoured (line ≥90, branch ≥85)
- [ ] 8.3 `pnpm build` — all new exports present in `dist/index.d.ts`
- [ ] 8.4 `openspec validate add-webhook-receiver --strict` passes
