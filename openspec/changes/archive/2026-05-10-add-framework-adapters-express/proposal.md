## Why

Phase 0 wired `@dojocoding/whatsapp/express` as a subpath export with a stub that throws. Phase 3 shipped the framework-agnostic `WebhookReceiver` whose `handlePayload` returns `{ status, dispatchPromise }` synchronously. Phase 8 finally lands the working Express adapter so consumers don't have to remember:
1. Register `express.raw({ type: "application/json" })` BEFORE any JSON parser.
2. Call `verifySignature` before invoking handlers.
3. Mount BOTH a `GET` (handshake) and `POST` (receiver) on the same path.
4. Ack 200 within Meta's 30 s deadline while running handlers async.
5. Translate handler errors into structured 500s.

A single `createWhatsAppMiddleware(receiver)` call delivers all of the above.

## What Changes

- **NEW** capability `framework-adapters`.
- **MODIFIED** `src/adapters/express/index.ts` (replaces the Phase 0 stub):
  - `createWhatsAppMiddleware(receiver, options?)` returns an Express `RequestHandler` (router-like). Mounted at any path the consumer picks via `app.use(path, mw)`.
  - Handles `GET` → calls `receiver.handleVerifyRequest({ mode, verifyToken, challenge })` from query params; responds with `200 challenge` on success or `403` on failure.
  - Handles `POST` → uses `express.raw({ type: "application/json" })` to read the raw bytes, calls `receiver.handlePayload(rawBody, signatureHeader, parsedBody)`, immediately responds with the `status` returned (200 or 401), and runs the `dispatchPromise` in the background.
  - Other verbs respond `405 Method Not Allowed`.
  - Handler exceptions caught from `dispatchPromise` are routed to an optional `options.onUnhandledHandlerError` callback (defaults to `console.error`).
- **NEW** dev dependencies: `express@^4` and `supertest@^7` (plus types) for integration tests.
- **NEW** `test/integration/express/middleware.test.ts` using `supertest` to drive an ephemeral Express server through the full handshake + signed POST + bad-sig 401 + 405-on-other-verbs cycle.

## Capabilities

### New Capabilities
- `framework-adapters`: Express middleware factory.

### Modified Capabilities
None — the Phase 0 stub on `./express` is replaced by working code, but the `exports` map in `package.json` is unchanged. Consumers were never able to call into the stub successfully (it threw); the move from "throws" to "works" is not a breaking change.

## Non-goals

- **No Fastify adapter in v1**: the design's primitives (`verifySignature`, `parseWebhookPayload`, `WebhookReceiver`) are framework-agnostic; a Fastify adapter is a follow-up.
- **No Next.js / Lambda adapters**.
- **No automatic webhook subscription** (`POST /{waba-id}/subscribed_apps`) — out of scope.
- **No body-size limit override**: the adapter inherits Express's default `100kb` raw-body limit. Consumers needing larger can wrap with their own `express.raw({ limit })` ahead of the middleware.

## Impact

- **Code**: replaces the stub in `src/adapters/express/index.ts`. No other source changes.
- **APIs**: `createWhatsAppMiddleware` becomes a working public export on `@dojocoding/whatsapp/express`.
- **Dependencies**: `express` and `supertest` as devDeps; runtime uses Express via the consumer's own dependency, threaded through `import type`.
- **Systems**: integration tests use an ephemeral `express()` instance + `supertest`; no real HTTP server.
