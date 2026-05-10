## Context

`createWhatsAppHandler` from `@dojocoding/whatsapp/web` is the
substrate every framework adapter wraps. Hono is the smallest such
wrapper imaginable: Hono's `Context` exposes the underlying Fetch-API
`Request` as `c.req.raw`, and returning a `Response` from a handler
is idiomatic Hono. The wrapper is one expression.

Domain rules from `openspec/config.yaml` that this design must satisfy:

- **Raw bytes BEFORE any JSON parser.** Already satisfied by the web
  core — Hono doesn't pre-parse the body unless the consumer asks it
  to (`c.req.json()` is opt-in).
- **Webhook ack within 30 s; handlers async.** Already satisfied by
  the web core; the wrapper does not introduce any await between
  receiving the request and returning the Response.
- **Zero global state.** The wrapper is a closure over the receiver.
  No shared module-level state.

## Goals / Non-Goals

**Goals:**

- `whatsappHandler(receiver, options?)` returns a Hono `Handler`
  (`Context => Promise<Response>`).
- Same `CreateWhatsAppHandlerOptions` shape as the web core
  (`onUnhandledHandlerError?`). Pass through unchanged.
- Integration test using Hono's `app.request(...)` test helper
  covering handshake / signature OK / signature tampered / 405.
- New `dist/adapters/hono/` subpath; `package.json` `exports` and
  `tsup` entry updated.

**Non-Goals:**

- Hono middleware composition helpers.
- Mounting under multiple paths from one factory call.
- Special handling for Hono's variants (Honox, Hono RPC). Those use
  the same handler shape; same wrapper.

## Decisions

### Decision: re-export the options type, don't redefine it

**Rationale.** `CreateWhatsAppHandlerOptions` is the contract. Any
adapter that re-derives its own option type creates drift on the day
the web core adds a new option. Re-export with an alias if a more
Hono-flavoured name is desired (none today).

**Alternatives considered.** A new `CreateWhatsAppHonoHandlerOptions`
type — pointless duplication.

### Decision: the wrapper is a function, not a Hono middleware factory

**Rationale.** Hono mounts handlers and middlewares differently
(`app.use(mw)` vs `app.all(path, handler)`). For a webhook endpoint
the consumer wants a handler bound to a specific path — `app.all(path,
whatsappHandler(receiver))` is the idiomatic shape. Returning a
middleware would be wrong here because the handler is terminal: it
always produces a `Response`, never calls `next()`.

**Alternatives considered.** Return a middleware that conditionally
delegates — adds complexity for no benefit.

### Decision: ship `hono` as an optional peer, not a regular dep

**Rationale.** Mirrors the `express` pattern. Consumers who don't
import `/hono` don't pull `hono` into their dep tree. The `tsup`
build externalises `hono` so no copy ships in the published
artefacts.

### Decision: control flow

```
inbound Hono request
  │  app.all("/webhooks/whatsapp", whatsappHandler(receiver))
  ▼
whatsappHandler returns (c) => coreHandler(c.req.raw)
  │
  ▼
createWhatsAppHandler (web core) does the work
  │
  ▼
Response returned to Hono runtime
```

That's the whole adapter.

## Risks

- **Hono version range**: Hono moves fast; we peer on `^4` for now.
  When Hono 5 ships, expand the range after smoke-testing.
- **`c.req.raw` availability**: `c.req.raw` has been in Hono since
  v3. We require `^4`, so this is non-risk.
- **Type drift on Hono's `Handler`**: re-exporting Hono's own
  `Handler` type via the `import type` keeps us coupled to whatever
  Hono ships. If we want to widen the supported range (`>=3 <5`),
  the type re-export gets tricky. Defer until anyone asks.

## Test layers

- **Integration**: `test/integration/hono/handler.test.ts` using
  `new Hono()` + `app.request("/webhook", { method, headers, body })`.
  Same fixture set the Express integration suite uses. No
  duplicate web-core scenarios — those run in
  `test/contract/adapters/web/`.

## Bundle expectations

Because tsup runs with `splitting: false` (CJS doesn't share chunks
cleanly), each entry inlines whatever it imports. The Hono entry
inlines the web core (~1.5 KB) plus a 50-byte wrapper. Total:

- `dist/adapters/hono/index.js`: ~1.8 KB
- `dist/adapters/hono/index.cjs`: ~1.9 KB
- `dist/adapters/hono/index.d.ts`: ~1.5 KB (type re-exports)

The runtime has **zero references to Hono itself** — `import type
{ Handler } from "hono"` is type-only and tsup strips it. Hono is
only required at the consumer's typecheck step, not at runtime.

If a future change introduces a runtime dependency on Hono (e.g. by
importing the `Context` value, not just the type), this should fail
review unless the value-import is genuinely needed.
