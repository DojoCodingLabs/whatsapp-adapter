## Why

Hono is the de-facto routing layer on Cloudflare Workers, Bun, Deno,
and any edge / serverless target where Fetch-API handlers run. The
web-standard core shipped in `add-web-standard-adapter-core` already
gives consumers a working integration via `app.all(path, (c) =>
handler(c.req.raw))`. This change ships a one-call ergonomic wrapper
at `@dojocoding/whatsapp/hono` so the integration is `app.all(path,
whatsappHandler(receiver))` instead.

It's a small surface — the entire implementation is a function that
returns `(c) => createWhatsAppHandler(receiver)(c.req.raw)` — but it
delivers three things:

1. A typed Hono `Handler` return so IDE autocomplete works.
2. A documented integration point so consumers don't have to learn
   the web subpath + the Hono `c.req.raw` idiom together.
3. A concrete second adapter built on the web core, validating that
   the substrate is genuinely framework-agnostic.

## What Changes

- **NEW** `@dojocoding/whatsapp/hono` subpath export:
  `whatsappHandler(receiver, options?)` returns a Hono `Handler`.
- **NEW** `src/adapters/hono/index.ts`.
- **NEW** `hono` as an optional `peerDependency` (mirroring the
  `express` pattern); also added as a `devDependency` so the
  integration test runs.
- **NEW** `test/integration/hono/handler.test.ts` exercising
  handshake / valid signature / tampered body / 405 via Hono's
  `app.request(path, init)` test helper.
- **NEW** `docs/hono.md` and `docs/cookbook/hono.md`.
- **MODIFIED** `tsup.config.ts` entry map (adds the new subpath).
- **MODIFIED** `package.json` `exports` (adds `./hono`),
  `peerDependencies` + `peerDependenciesMeta`, `devDependencies`.
- **MODIFIED** `.github/workflows/ci.yml` pack-contents check
  (adds the Hono dist artefacts to the required-files list).
- **MODIFIED** `docs/architecture.md` capability table (adds the
  Hono row).
- **MODIFIED** `CHANGELOG.md` `[Unreleased]` (becomes `[0.3.0]`).

## Capabilities

### Modified Capabilities

- `framework-adapters`: a new Hono sub-capability is added with one
  scenario set ("Hono handler echoes the challenge", "Hono handler
  dispatches on valid signature", "Hono handler returns 401 on
  tampered body", "Hono handler returns 405 on other verbs"). All
  delegation behaviour is asserted via the web core; this delta
  asserts the wrapper shape and that integration through a Hono
  app works.

### New Capabilities

None.

## Non-goals

- **Other frameworks**: Fastify, Next.js, Workers cookbook stay where
  they are. A dedicated `@dojocoding/whatsapp/next` subpath is
  deferred until consumer demand justifies the maintenance cost; the
  current Next.js App Router integration is "use the web subpath" and
  is documented in `docs/web.md`.
- **Hono-specific niceties**: middleware composition, `c.json`-style
  response helpers, Zod-validator integration. The wrapper is a
  one-line delegation; consumers compose with Hono primitives outside
  of it.
- **Path routing**: the wrapper handles a single path. Routing is
  Hono's concern; consumers mount under whatever path they want via
  `app.all(path, whatsappHandler(receiver))`.

## Impact

- Bundle size: `dist/adapters/hono/index.cjs` is expected under 1 KB
  (literally a closure over the web handler).
- Runtime support: same as the web core — Node ≥ 20, Workers, Bun,
  Deno, any WinterCG-compliant runtime.
- Breaking changes: none. This is pure addition.
- npm: requires a new optional peer dep declaration; consumers who
  don't import `/hono` see no install impact.
