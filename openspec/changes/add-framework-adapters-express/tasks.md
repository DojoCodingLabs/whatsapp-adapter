## 1. Dev dependencies

- [x] 1.1 `pnpm add -D express@^4 supertest@^7 @types/express @types/supertest`.

## 2. Replace the Phase 0 stub

- [x] 2.1 Replace `src/adapters/express/index.ts` with a working `createWhatsAppMiddleware(receiver, options?)` that returns an Express `Router`. Mount GET (handshake), POST (raw-body verify + dispatch), and 405-on-other-verbs.
- [x] 2.2 Pull `signatureHeader` from `X-Hub-Signature-256` (case-insensitive). Use `req.body` (a `Buffer` after `express.raw`) for HMAC verification. Pass the parsed JSON (parsed once locally) to `handlePayload`.
- [x] 2.3 On 200, call `res.status(200).end()` BEFORE awaiting `dispatchPromise`. Attach `dispatchPromise.catch(onUnhandledHandlerError)` to surface handler errors.
- [x] 2.4 Update the in-file JSDoc to reflect the working implementation.

## 3. Tests

- [x] 3.1 Replace `test/unit/adapters/express.test.ts` (currently asserting the stub throws) with a unit-level test that asserts the factory returns a function (Express middleware shape).
- [x] 3.2 Add `test/integration/express/middleware.test.ts` using `supertest`:
  - GET handshake echo on valid token; 403 on wrong token.
  - POST with valid signature → 200 + handler runs.
  - POST with tampered body → 401 + no handler.
  - PUT/DELETE → 405.
  - Slow handler does not delay the 200 ack (use a 100ms-resolving handler and assert response < 50ms).
  - Handler error fires `onUnhandledHandlerError`.

## 4. Verification

- [x] 4.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [x] 4.2 `pnpm test:coverage` — gates honoured.
- [x] 4.3 `pnpm build` — `createWhatsAppMiddleware` callable from `dist/adapters/express/`.
- [x] 4.4 `openspec validate add-framework-adapters-express --strict` passes.
