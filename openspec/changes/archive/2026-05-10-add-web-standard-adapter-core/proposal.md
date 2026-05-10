## Why

The Express adapter is currently the only way to mount this SDK into a
running HTTP service. Adding adapters per framework (Hono, Fastify, Next.js
App Router, Cloudflare Workers, Bun, Deno, AWS Lambda) would mean N copies
of the same raw-body-capture + ack-within-30s + signature-verify glue.
Worse, four of those runtimes (Workers, Bun edge, Deno, AWS Lambda
streaming) don't have `node:crypto` — every adapter that targets them
would have to re-derive WebCrypto-equivalent signature verification.

The leverage move is one **web-standard `Request → Response` core** that
all other adapters wrap. Workers, Hono, Next.js App Router, Bun, Deno,
and Lambda Web Adapter all speak Fetch-API; the existing Express
middleware becomes a thin Node-req/res ↔ Request shim over the same
core.

To make the core actually portable, three modules currently coupled to
`node:crypto` are migrated to WebCrypto:

- `src/webhooks/signature.ts` — HMAC-SHA256 over raw bytes
- `src/webhooks/handshake.ts` — constant-time verify-token compare
- `src/observability/redact.ts` — SHA-256 for `hashPhoneNumberId`

The web core is the substrate; Track B2 (Hono adapter) and future
Workers / Bun cookbooks all wrap it without re-implementing the
contract.

## What Changes

- **NEW** `@dojocoding/whatsapp/web` subpath export: `createWhatsAppHandler(receiver, options?)` returns `(req: Request) => Promise<Response>`.
- **MODIFIED** `src/webhooks/signature.ts`: HMAC-SHA256 now uses `crypto.subtle.sign` + a constant-time byte-array compare. Public function shape unchanged but becomes `async`. All call sites updated.
- **MODIFIED** `src/webhooks/handshake.ts`: constant-time string compare without `node:crypto.timingSafeEqual`. Length-pre-check preserved.
- **MODIFIED** `src/observability/redact.ts`: `hashPhoneNumberId` uses `crypto.subtle.digest("SHA-256", ...)`. Public function becomes `async`; salt configuration via `setRedactSalt` unchanged.
- **MODIFIED** `src/adapters/express/index.ts`: reimplemented as a thin shim that buffers the request, builds a `Request`, calls the web core, and writes the resulting `Response` back to the Express `res`. Existing public API (`createWhatsAppMiddleware`) and behaviour preserved; existing tests still pass.
- **MODIFIED** `src/webhooks/receiver.ts`: `handlePayload` is updated to await the new async signature verification. The 30-second-ack contract is preserved — the receiver still returns `{ status, dispatchPromise }` and the adapter still responds before awaiting dispatch.
- **NEW** `test/contract/adapters/web/` covering handshake, signature, dispatch, and method routing against plain `Request` fixtures.
- **NEW** `docs/web.md` and `docs/cookbook/cloudflare-workers.md` showing Workers and Bun wiring.

## Capabilities

### Modified Capabilities

- `framework-adapters`: adds a new sub-capability for the web-standard
  handler. The Express sub-capability is rewritten on top of it but its
  externally-observable behaviour is unchanged.
- `webhook-receiver`: the signature verification primitive becomes
  runtime-portable; observable behaviour unchanged.
- `observability`: `hashPhoneNumberId` becomes runtime-portable;
  observable behaviour unchanged (same digest bytes for the same input
  and salt).

### New Capabilities

None — the web handler lives inside `framework-adapters`.

## Non-goals

- **Hono / Next.js / Workers / Bun adapter packages**: deferred to
  Track B2 (Hono) and follow-ups. This change ships the core that
  those adapters will wrap, plus a Workers cookbook entry.
- **AWS Lambda adapter**: deferred.
- **Streaming media uploads** from the web core: media download/upload
  paths still use Node streams; the web core handles webhooks only.
- **Changing the public-API shape of `verifySignature` / `verifyHandshake`
  / `hashPhoneNumberId`** beyond making them async. No new options,
  no renamed parameters.

## Impact

- Public API: `verifySignature`, `verifyHandshake`, and `hashPhoneNumberId`
  become `async`. Call sites inside the SDK are updated; any external
  caller using them directly will get a Promise instead of a value.
  Documented in CHANGELOG as a `0.2.0` minor-breaking change.
- Bundle size: WebCrypto is a runtime built-in everywhere we target,
  so the migration removes the `node:crypto` import — net bundle size
  decreases.
- Runtime support: the web core runs unmodified on Node ≥ 20,
  Cloudflare Workers, Bun, Deno, and any WinterCG-compliant runtime.
