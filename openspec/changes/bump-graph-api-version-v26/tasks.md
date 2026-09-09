## 1. Constant + comment

- [x] 1.1 `packages/whatsapp-sdk/src/types/constants.ts`: `"v25.0"` → `"v26.0"`.
- [x] 1.2 `packages/whatsapp-sdk/src/messages/types.ts`: header comment `(Graph API v23)` → `(Graph API v26)`.

## 2. Tests

- [x] 2.1 `test/unit/types/constants.test.ts` assertion → `"v26.0"`.
- [x] 2.2 Bulk `sed` of `v25.0` → `v26.0` across `packages/whatsapp-sdk/test/**` and `packages/whatsapp-mcp/test/**`; `rg v25\.0 packages` returns nothing outside `CHANGELOG.md`.
- [x] 2.3 Full `pnpm -r test` green.

## 3. Spec + docs

- [x] 3.1 Spec delta for `cloud-api-client` (construction scenario, constant requirement, URL-construction scenarios).
- [x] 3.2 `AGENTS.md` hard-rule line + "Bump the pinned Graph API version" recipe (site count, `rg` check).
- [x] 3.3 `CLAUDE.md` project-status paragraph.
- [x] 3.4 `docs/architecture.md`, `docs/compliance.md` (§2 table + §3.1), `docs/sdk/client.md`, `docs/sdk/mock.md`, `docs/mcp/auth.md`.
