## Context

The Express adapter shipped in Phase 8 satisfies all of Meta's webhook
requirements (raw-body HMAC, 30 s ack, polymorphic dispatch) — but only
inside Express. The WebhookReceiver is framework-agnostic; the
problem is that the moving parts AROUND the receiver (raw-byte capture,
signature verification, observability redaction) all reach into
`node:crypto`, which doesn't exist on Cloudflare Workers, Bun's edge
runtime, Deno, or the streaming Lambda Web Adapter.

The Fetch-API `Request`/`Response` pair is the lingua franca: Workers,
Bun, Deno, Hono, Next.js App Router route handlers, and Express (via
shim) all speak it. The smallest unit of portability worth shipping
is a single function:

```ts
type WhatsAppHandler = (req: Request) => Promise<Response>;
```

Once this exists, every other adapter is a 10-line wrapper, and the
WebCrypto migration is required only inside the three modules listed
above.

Domain rules from `openspec/config.yaml` § "Domain rules — never
violate" this design must satisfy:

- **Raw bytes BEFORE any JSON parser.** The web core reads `await
  req.arrayBuffer()` once, computes HMAC over those exact bytes, then
  parses JSON from a copy.
- **HMAC compare must be timing-safe.** Web core uses a constant-time
  byte-array compare over the digest bytes; no early-exit on first
  mismatch.
- **Webhook ack to Meta MUST be 200 within 30 s; handlers run async.**
  The web core returns the `Response` immediately after receiver
  `handlePayload` returns its sync result; `dispatchPromise` runs in
  the background via `event.waitUntil` (Workers) or unawaited promise
  chain (Node/Bun/Deno).
- **Every webhook handler invocation gets an OTel span; PII redacted.**
  Unchanged — the receiver wires those spans; the web core is below
  that layer.

## Goals / Non-Goals

**Goals:**

- `createWhatsAppHandler(receiver, options?)` returning a
  `(Request) => Promise<Response>` that satisfies the same scenarios
  the Express adapter already passes (handshake, signature, dispatch,
  405).
- WebCrypto-only inside `signature.ts`, `handshake.ts`,
  `observability/redact.ts`.
- Express adapter reimplemented on top of the web core. External
  behaviour byte-identical; all existing integration tests pass
  unchanged.
- New `dist/adapters/web/` subpath export, listed in `package.json`
  `exports` and tsup `entry`.
- Bundle size of `dist/adapters/web/*` stays under 5 KB (this is
  glue, not framework code).

**Non-Goals:**

- Hono / Workers / Bun framework adapter packages — Track B2 +
  follow-ups.
- Streaming response support — Meta webhooks never need a streaming
  response.
- Request body size limits — left to the consumer's runtime (Express
  defaults to 100 KB, Workers to 100 MB; neither is something this
  library should override).

## Decisions

### Decision: web core is a flat function, not a class

**Rationale.** No mutable state lives in the handler — all state is in
the `WebhookReceiver` instance passed in. A class would buy nothing
and force a `.handle(req)` style that's awkward to register with
`addEventListener` or `app.all(path, handler)`.

**Alternatives considered.** A class with `.handle(req)` — adds the
`.handle` keystroke without benefit. A higher-order builder like
`webApp(receiver).route(path).handler` — premature for one route.

### Decision: signature verification stays inside the receiver

**Rationale.** The receiver already owns dispatch and dedupe; it must
own signature verification too, otherwise the adapter could
short-circuit by skipping the call. The web core feeds raw bytes +
signature header to `receiver.handlePayload(rawBody, signatureHeader,
parsedBody)` — same shape the Express adapter uses today.

**Alternatives considered.** Verifying signature in the adapter and
calling `receiver.dispatch(parsedEvent)` directly — splits invariant
enforcement across two modules; the receiver could no longer claim to
be the source of truth.

### Decision: public verify/hash functions become async

**Rationale.** WebCrypto's `subtle.sign` / `subtle.digest` are async.
We could wrap them with `Atomics.wait` to fake sync on Node, but that
costs a worker thread per call and doesn't work in Workers anyway.
Async is the honest shape.

**Alternatives considered.** Keep sync via a Node-only path and a
WebCrypto-only path with runtime detection — doubles the surface and
the test matrix. Lazy-precompute the redact-salt hash and keep
`hashPhoneNumberId` sync — only works for `hashPhoneNumberId`, not
for HMAC.

**Migration:** internal call sites are updated. External users will
see `await verifySignature(...)` instead of `verifySignature(...)`
returning a boolean. This is a minor-breaking change in pre-1.0
semver; CHANGELOG flags it.

### Decision: Express shim buffers the request body

**Rationale.** `express.raw({ type: "application/json" })` already
captures the body as a `Buffer`. The shim converts that Buffer to a
`Uint8Array`, builds a `Request` with method/url/headers/body, calls
the web core, then writes the resulting `Response`'s status / headers
/ body back to `res`. Express's existing `req.body` stays available
for other middleware downstream.

**Alternatives considered.** Use `Readable.toWeb(req)` to bridge the
streams — heavier dependency on `stream/web` and the streaming
semantics don't help here since Meta's webhooks fit in a single
`Buffer`.

### Decision: control flow

```
inbound HTTPS request
  │
  ▼
adapter (Express / Hono / Workers fetch handler)
  │  buffers raw bytes; builds Request
  ▼
web core: createWhatsAppHandler(receiver)
  │  GET  → receiver.handleVerifyRequest(...)
  │  POST → receiver.handlePayload(rawBody, sigHeader, parsedBody)
  │  other → 405
  ▼
receiver returns { status, dispatchPromise }
  │
  ▼
web core returns Response immediately
  │
  ▼  (in parallel, never awaited inside the handler)
dispatchPromise resolves → handlers fire
```

## Risks

- **WebCrypto availability on older Node**: WebCrypto is stable in
  Node 20+ via `globalThis.crypto`. We already require Node ≥ 20 in
  `engines`, so this is non-risk.
- **HMAC bytes differing between `node:crypto` and `crypto.subtle`**:
  both produce identical bytes for HMAC-SHA256 given identical inputs.
  Verified by a vector-comparison test in this change.
- **Buffer ↔ Uint8Array conversion overhead in the Express shim**:
  one `Buffer` → `Uint8Array` zero-copy view per request. Negligible.
- **Async migration breaks consumers calling `verifySignature`
  directly**: documented in CHANGELOG; pre-1.0 minor-breaking change.

## Test layers

- **Unit**: `node:crypto`-vs-WebCrypto HMAC parity vectors; constant-
  time compare property tests for handshake.
- **Contract**: `test/contract/adapters/web/*` covering handshake echo,
  valid signature dispatch, tampered-body 401, 405-on-other-verbs.
- **Integration**: existing Express integration suite reruns
  unmodified on the new shim and stays green.
- **Cookbook smoke**: `docs/cookbook/cloudflare-workers.md` example
  is compiled with `miniflare` in a CI smoke step (added by Track F or
  inline here — leaning inline so the cookbook entry isn't
  drift-bait).
