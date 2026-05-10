## 1. Package metadata and tooling configs

- [x] 1.1 Create `package.json` (`@dojocoding/whatsapp`, Node ≥20, `type: "module"`, `exports` map for `.` and `./express`, scripts: `build`, `typecheck`, `lint`, `test`, `test:coverage`)
- [x] 1.2 Create `tsconfig.json` (strict, ES2022, `moduleResolution: "Bundler"`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [x] 1.3 Create `tsconfig.build.json` (extends base, `outDir: "dist"`, `declaration: true`, excludes tests)
- [x] 1.4 Create `tsup.config.ts` (dual ESM+CJS, two entries: `src/index.ts` and `src/adapters/express/index.ts`, `.d.ts` rollup)
- [x] 1.5 Create `vitest.config.ts` (coverage gate line ≥90, branch ≥85, includes `test/**/*.test.ts`)
- [x] 1.6 Create `eslint.config.mjs` (flat config: TS recommended, import/order, no-unused-vars, no-floating-promises, no `any` in `src/`)
- [x] 1.7 Create `.prettierrc` and `.prettierignore`
- [x] 1.8 Create `.editorconfig`
- [x] 1.9 Create `.nvmrc` pinning Node 20

## 2. Source layout

- [x] 2.1 Create empty index files for each capability dir: `src/{client,messages,webhooks,window,templates,mock,observability,adapters,types}/index.ts`
- [x] 2.2 Create `src/types/constants.ts` exporting `GRAPH_API_VERSION`, `META_GRAPH_BASE_URL`, `WEBHOOK_ACK_DEADLINE_MS`, `WINDOW_TTL_MS`, all `as const`
- [x] 2.3 Create `src/types/errors.ts` defining `WhatsAppError` base + `MissingCredentialsError`, `RateLimitError`, `WindowClosedError`, `WebhookSignatureError`, `TemplateError`, `MockModeError`, each with `readonly code` discriminator and prototype-chain patch
- [x] 2.4 Create `src/client/whatsapp-client.ts` with `WhatsAppClient` class — constructor stores credentials and validates them; throws `MissingCredentialsError` on missing/empty fields; no network I/O
- [x] 2.5 Create `src/adapters/express/index.ts` stub exporting `createWhatsAppMiddleware()` that throws `Error("@dojocoding/whatsapp/express is not implemented yet — see Phase 8")`
- [x] 2.6 Wire `src/index.ts` to re-export the public surface (`WhatsAppClient`, all error classes, all constants, type aliases)

## 3. Tests

- [x] 3.1 Create `test/__fixtures__/webhooks/.gitkeep` placeholder so the dir is tracked
- [x] 3.2 Add `test/unit/types/errors.test.ts` covering: instanceof chain (subclass → WhatsAppError → Error), `code` discriminator value per subclass, JSON.stringify does not leak `token`/`appSecret` if attached to a custom error
- [x] 3.3 Add `test/unit/types/constants.test.ts` covering: `GRAPH_API_VERSION` matches `/^v\d+\.\d+$/`, `WEBHOOK_ACK_DEADLINE_MS === 30000`, `WINDOW_TTL_MS === 86_400_000`, `META_GRAPH_BASE_URL === "https://graph.facebook.com"`
- [x] 3.4 Add `test/unit/client/whatsapp-client.test.ts` covering: construction with all credentials succeeds; construction with empty `token` throws `MissingCredentialsError` with `code === "MISSING_CREDENTIALS"` and `missingFields` containing `"token"`; construction with multiple missing fields lists all of them; default `graphApiVersion` equals `GRAPH_API_VERSION`; custom override is honored; error message does not leak credential values
- [x] 3.5 Add `test/unit/adapters/express.test.ts` asserting the stub throws on import-time invocation with the documented Phase 8 message

## 4. CI and dev experience

- [x] 4.1 Create `.github/workflows/ci.yml` running on `push` and `pull_request`: setup pnpm + Node 20, install, `pnpm typecheck`, `pnpm lint`, `pnpm test --coverage`, `pnpm build`, `pnpm openspec:validate`
- [x] 4.2 Add `pnpm openspec:validate` script invoking `openspec validate --changes --strict` (no-op if there are no active changes)
- [x] 4.3 Add a husky-equivalent or simple `pre-commit` script (lint-staged via `simple-git-hooks` or husky v9) running `pnpm lint --fix` and `pnpm typecheck` on staged files

## 5. Verification

- [x] 5.1 Run `pnpm install && pnpm typecheck && pnpm lint && pnpm test --coverage && pnpm build` locally — all green (24/24 tests, 100% coverage)
- [x] 5.2 Run `openspec validate bootstrap-whatsapp-adapter --strict` — passes
- [x] 5.3 Confirm `dist/` contains both `index.js` (ESM) and `index.cjs` (CJS) plus `index.d.ts`, and that `dist/adapters/express/index.{js,cjs,d.ts,d.cts}` exists
- [x] 5.4 `node -e "console.log(require('./dist/index.cjs').GRAPH_API_VERSION)"` prints `v23.0`
