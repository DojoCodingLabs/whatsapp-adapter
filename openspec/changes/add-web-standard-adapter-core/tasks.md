## 1. WebCrypto migration of crypto primitives

- [ ] 1.1 Rewrite `src/webhooks/signature.ts` to use `crypto.subtle.sign("HMAC", ...)` + a constant-time `Uint8Array` compare. Function becomes `async`.
- [ ] 1.2 Add a parity unit test in `test/unit/webhooks/signature-webcrypto-parity.test.ts` that computes HMAC-SHA256 with `node:crypto.createHmac` and with `crypto.subtle.sign` over the same vectors and asserts byte-equal digests.
- [ ] 1.3 Update every internal call site of `verifySignature` to `await` it. Most are inside `WebhookReceiver.handlePayload` which is already async.
- [ ] 1.4 Rewrite `src/webhooks/handshake.ts` `verifyHandshake` to use a constant-time string compare (length-prefix check, then byte-by-byte) without `node:crypto.timingSafeEqual`.
- [ ] 1.5 Add a property-based test for the constant-time compare (fast-check): for any two strings of equal length, the function returns `true` iff the strings are byte-equal, and runtime variance across inputs is bounded.
- [ ] 1.6 Rewrite `src/observability/redact.ts` `hashPhoneNumberId` to use `crypto.subtle.digest("SHA-256", ...)`. Function becomes `async`. Salt configuration unchanged.
- [ ] 1.7 Update internal call sites of `hashPhoneNumberId` to `await` it; these are inside `withSpan` and are already inside async contexts.
- [ ] 1.8 Add a parity unit test in `test/unit/observability/redact-webcrypto-parity.test.ts` comparing digests across the two implementations.

## 2. Web-standard handler core

- [ ] 2.1 Create `src/adapters/web/index.ts` exporting `createWhatsAppHandler(receiver, options?)`. Function signature returns `(req: Request) => Promise<Response>`.
- [ ] 2.2 GET branch: pull `hub.mode`, `hub.verify_token`, `hub.challenge` from `new URL(req.url).searchParams`. Call `receiver.handleVerifyRequest(...)`. On match, return `new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } })`. On mismatch, return `new Response(null, { status: 403 })`.
- [ ] 2.3 POST branch: `const rawBody = new Uint8Array(await req.arrayBuffer())`. Pull `X-Hub-Signature-256` header (case-insensitive). Parse JSON from a copy. Call `receiver.handlePayload(rawBody, sigHeader, parsedBody)`. Return the receiver's `status` immediately. Attach `dispatchPromise.catch(options?.onUnhandledHandlerError ?? console.error)` so handler errors surface without blocking the ack.
- [ ] 2.4 Other verbs: return `new Response(null, { status: 405 })`.
- [ ] 2.5 Add `CreateWhatsAppHandlerOptions` matching the Express shape (just `onUnhandledHandlerError?` for now).
- [ ] 2.6 Export `createWhatsAppHandler` and the options type from a new `src/adapters/web/index.ts`.

## 3. Tests for the web handler

- [ ] 3.1 Create `test/contract/adapters/web/handshake.test.ts`: GET with valid token echoes challenge as 200 text/plain; wrong token returns 403.
- [ ] 3.2 Create `test/contract/adapters/web/signature.test.ts`: POST with a valid signature returns 200 and triggers handlers; tampered body returns 401 with no handler invocation.
- [ ] 3.3 Create `test/contract/adapters/web/method-routing.test.ts`: PUT / DELETE / PATCH return 405.
- [ ] 3.4 Create `test/contract/adapters/web/ack-timing.test.ts`: a handler that resolves after 100 ms still returns 200 within 20 ms.

## 4. Reshim Express on the web core

- [ ] 4.1 Replace `src/adapters/express/index.ts` body with a shim that buffers `req` via `express.raw({ type: "application/json" })`, constructs a `Request` (method, url, headers, Uint8Array body), calls the web core, writes the resulting `Response` back to `res` (status, headers, body).
- [ ] 4.2 Verify `test/integration/express/middleware.test.ts` still passes unchanged. If a behavior shifts, fix the shim, not the test.
- [ ] 4.3 Update the in-file JSDoc to reflect "thin shim over web core".

## 5. Build & exports

- [ ] 5.1 Add `"adapters/web/index": "src/adapters/web/index.ts"` to `tsup.config.ts` `entry`.
- [ ] 5.2 Add `./web` to `package.json` `exports` mirroring the `./express` shape (types, import, require).
- [ ] 5.3 Verify `dist/adapters/web/index.{js,cjs,d.ts,d.cts}` exist and the CJS bundle is under 5 KB.
- [ ] 5.4 Extend the CI pack-contents check to require `package/dist/adapters/web/index.js` and `.cjs` and `.d.ts`.

## 6. Documentation

- [ ] 6.1 Add `docs/web.md` mirroring `docs/express.md` (mount example, options, behaviour).
- [ ] 6.2 Add `docs/cookbook/cloudflare-workers.md` showing a Worker `fetch(event)` handler delegating to `createWhatsAppHandler(receiver)`.
- [ ] 6.3 Add `docs/cookbook/bun.md` (or fold into the Workers entry — short).
- [ ] 6.4 Update `docs/architecture.md` capability table to include the web adapter row.
- [ ] 6.5 Update `README.md` Quickstart to mention the web subpath as an alternative to Express.
- [ ] 6.6 Update `CHANGELOG.md` under `[Unreleased]` (or whatever the next version section is) with the user-visible changes: new web subpath + async migration of three crypto primitives.
