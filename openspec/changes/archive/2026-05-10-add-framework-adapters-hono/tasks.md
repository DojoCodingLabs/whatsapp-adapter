## 1. Dependencies

- [x] 1.1 `pnpm add -D hono@^4` for the integration test.
- [x] 1.2 Add `hono: "^4.0.0"` to `peerDependencies` with `peerDependenciesMeta.hono.optional = true` (mirroring the `express` pattern).
- [x] 1.3 Add `"hono"` to `tsup.config.ts` `external` so the build does not bundle it.

## 2. Adapter implementation

- [x] 2.1 Create `src/adapters/hono/index.ts` exporting `whatsappHandler(receiver, options?)`. The return value is a Hono `Handler`: `(c: Context) => coreHandler(c.req.raw)` where `coreHandler = createWhatsAppHandler(receiver, options)`.
- [x] 2.2 Re-export `CreateWhatsAppHandlerOptions` as `WhatsAppHonoHandlerOptions` for symmetry with the Express adapter, but keep the same shape (single source of truth on the web core).
- [x] 2.3 In-file JSDoc with a one-line mount example and a pointer to `docs/hono.md`.

## 3. Tests

- [x] 3.1 Create `test/integration/hono/handler.test.ts`. Build a Hono app, mount `whatsappHandler(receiver)` on `/webhook`, and drive it via `app.request("/webhook", init)`.
- [x] 3.2 Test cases:
  - GET with a valid `hub.verify_token`: 200 text/plain, body is the challenge.
  - GET with a wrong token: 403.
  - POST with a valid signature: 200 + handler invoked.
  - POST with a tampered body: 401 + handler NOT invoked.
  - PUT / DELETE: 405 with `Allow: GET, POST`.
- [x] 3.3 Use the same `text-inbound.json` fixture the web contract suite uses.
- [x] 3.4 Use a Promise-resolved-by-the-handler pattern (not `setTimeout`) to wait for the dispatch promise — same pattern that fixed the flaky web signature test.

## 4. Build & exports

- [x] 4.1 Add `"adapters/hono/index": "src/adapters/hono/index.ts"` to `tsup.config.ts` `entry`.
- [x] 4.2 Add `./hono` to `package.json` `exports` mirroring the `./express` shape.
- [x] 4.3 Verify `dist/adapters/hono/index.{js,cjs,d.ts,d.cts}` exist and the CJS bundle is under 1 KB.
- [x] 4.4 Extend the CI pack-contents check to require the Hono dist artefacts.

## 5. Documentation

- [x] 5.1 Add `docs/hono.md` modelled on `docs/express.md` — exports, mount example, options, threading model. Cross-link to `docs/web.md` since the wrapper is "the web core, just nicer for Hono".
- [x] 5.2 Add `docs/cookbook/hono.md` showing a complete Hono + Cloudflare Workers shape end-to-end.
- [x] 5.3 Update `docs/architecture.md` capability table to include the Hono row.
- [x] 5.4 Update `docs/cookbook/README.md` index with the Hono recipe.
- [x] 5.5 Update `CHANGELOG.md` `[Unreleased]` with the new `/hono` subpath.
- [x] 5.6 Replace the existing inline `docs/web.md` § Hono snippet with a one-line link to `docs/hono.md`.

## 6. Archive

- [x] 6.1 Push, wait for CI green on the change, run `openspec validate --changes --strict`.
- [x] 6.2 Tick all task checkboxes.
- [x] 6.3 `openspec archive add-framework-adapters-hono --yes`.
- [x] 6.4 Commit the archive + spec deltas merge.
