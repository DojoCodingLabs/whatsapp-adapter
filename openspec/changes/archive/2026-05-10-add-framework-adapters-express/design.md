## Context

The Phase 0 stub on `@dojocoding/whatsapp/express` made the subpath available so the package's `exports` map could ship final from day 0. Phase 8 lands the body. The framework-agnostic `WebhookReceiver` already does the heavy lifting (`handlePayload` returns a sync `{ status, dispatchPromise }`) — the Express adapter is glue that captures raw bytes, threads them through the receiver, and translates the result into Express semantics.

Domain rules from `openspec/config.yaml` `context` that this design must satisfy:
- HMAC over RAW bytes — `express.json()` re-serialisation breaks signature verification.
- Webhook 200 ack within 30 s; handlers run async.
- Receiver is the source of truth — dedupe and dispatch happen there, not in the adapter.

## Goals / Non-Goals

**Goals:**
- A `createWhatsAppMiddleware(receiver, options?)` that consumers mount with `app.use(path, mw)`.
- GET handshake delegated to `receiver.handleVerifyRequest`.
- POST receiver delegated to `receiver.handlePayload` with raw-body captured via `express.raw`.
- 405 on other verbs.
- Optional `options.onUnhandledHandlerError` for handler-throw observation.
- Integration tests with `supertest` against an ephemeral Express app — no real HTTP server.

**Non-Goals:**
- Fastify / Next / Lambda adapters.
- Body-size override (consumers wrap their own `express.raw({ limit })`).
- Auto-subscription via `POST /{waba-id}/subscribed_apps`.

## Decisions

### Decision: middleware is a `Router` mounted with `app.use(path, mw)`
**Rationale.** Routers can multiplex GET + POST + 405-on-other-verbs on the same path with idiomatic Express semantics. A bare `RequestHandler` would force consumers to do `app.get(path, mw)` + `app.post(path, mw)` separately and lose the 405 short-circuit.
**Alternatives considered.** Two separate factories (`createGetHandler` / `createPostHandler`) — twice the API for the same effect. A single function the consumer calls per-verb — more boilerplate.

### Decision: raw body captured via `express.raw({ type: "application/json" })` inside the router
**Rationale.** Putting `express.raw` inside the router keeps the consumer's app config minimal — they don't have to remember to register it before the WhatsApp middleware. If a consumer puts `express.json()` BEFORE the WhatsApp middleware globally, the body is already consumed and the raw layer sees an empty body — but that mistake produces an obvious symptom (401s) and the docs / inline comment make the canonical wiring (`mw before json()`) clear.
**Alternatives considered.** Document raw-body setup but don't include it (footgun: many consumers will forget). Use a custom raw-body reader that bypasses Express middleware ordering (more code, more bugs).

### Decision: middleware acks 200 BEFORE awaiting `dispatchPromise`
**Rationale.** Meta requires acks within 30 s. A slow handler (DB write, downstream API call) could push past that. Acking immediately and dispatching asynchronously is what the receiver was designed for; the adapter just calls `res.end()` then `dispatchPromise.catch(onUnhandledHandlerError)`.
**Alternatives considered.** Await dispatchPromise then ack (defeats the whole point of `dispatchPromise`).

### Decision: `onUnhandledHandlerError` defaults to `console.error`
**Rationale.** Silent swallowing of handler errors is the worst possible default. Logging to stderr lets operators see "something went wrong" while the response stays 200 (Meta's perspective: the webhook was acked). Consumers wanting structured logging override the default.
**Alternatives considered.** Throw uncaught (process-crashing). Default to no-op (silent loss).

### Decision: `405 Method Not Allowed` for non-GET / non-POST
**Rationale.** Closer to HTTP semantics than 404. If a misconfigured CORS preflight hits the path, the adapter returns 405 with `Allow: GET, POST`, signalling the explicit verb support.
**Alternatives considered.** 404 (less informative). Pass-through to next handler (could leak handler internals to the public).

```
                ┌─────────────────────────────────────┐
                │  app.use("/webhook", mw)            │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                       ┌──────────────────────┐
                       │  Router (GET / POST) │
                       └────────┬─────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
           GET handler     POST handler     405 fallthrough
           (handshake)     (raw body +      (other verbs)
                            handlePayload)

                       POST: rawBody → handlePayload
                                           │
                                ┌──────────┼──────────┐
                                ▼                     ▼
                          { status: 200,        { status: 401 }
                            dispatchPromise }
                                │
                                ▼
                          res.status(200).end()
                                │
                                ▼
                  dispatchPromise.catch(onUnhandledHandlerError)
```

## Risks / Trade-offs

- **Risk:** Consumer registers `express.json()` globally before our middleware; raw body is empty and POSTs return 401. **Mitigation:** README note + inline doc explicitly call this out.
- **Risk:** `supertest` and `express` versions drift. **Mitigation:** pin major versions in devDeps; integration tests catch drift on every CI run.
- **Trade-off:** Adapter DEFAULTS to `console.error` for unhandled handler errors. Acceptable; better than silent loss.

## Migration Plan

The Phase 0 stub on `./express` was always-throwing, so any consumer importing from it would already see errors. Replacing the stub with working code is a strict improvement.

## Open Questions

- Should the adapter expose a `path` option that defaults to `"/"`? **Tentative:** no — consumers control mount path via `app.use(path, mw)`. Adding our own path option doubles the configuration surface for no real benefit.
