## 1. Phase 1 — rename in `transport.ts`

- [ ] 1.1 In `packages/whatsapp-sdk/src/client/transport.ts`:
  - Rename `RequestOptions.idempotencyKey` → `RequestOptions.requestId`.
  - Rename the local `IDEMPOTENCY_HEADER` constant → `REQUEST_ID_HEADER = "X-Request-Id"`.
  - Rename the in-function local `idempotencyKey` variable → `requestId`.
  - Rename the OTel span attribute `whatsapp.idempotency_key` → `whatsapp.request.id`.
- [ ] 1.2 Update the `doFetch` signature accordingly.
- [ ] 1.3 Update the JSDoc on `RequestOptions.requestId` to remove the "idempotency" framing and explain the correlation use case.

## 2. Phase 2 — propagate to call sites

- [ ] 2.1 Grep `idempotencyKey` across `packages/whatsapp-sdk/src/` and update every call site.
- [ ] 2.2 Grep `idempotency_key` (snake case) across the same; update.
- [ ] 2.3 Grep `X-Dojo-Idempotency-Key` across the workspace (incl. docs) and rename.

## 3. Phase 3 — tests

- [ ] 3.1 Update `packages/whatsapp-sdk/test/contract/cloud-api-client/transport.test.ts`:
  - Every reference to `idempotencyKey` → `requestId`.
  - Every reference to `X-Dojo-Idempotency-Key` → `X-Request-Id`.
- [ ] 3.2 Update any other test that reads the option or asserts the header.
- [ ] 3.3 Update tests that assert OTel span attributes from `whatsapp.idempotency_key` → `whatsapp.request.id`.
- [ ] 3.4 Add a new test confirming the UUID is reused across retry attempts (codifies the existing behaviour under the new name).
- [ ] 3.5 Run `pnpm test` and verify all 591 SDK tests pass.

## 4. Phase 4 — docs + migration

- [ ] 4.1 Update `docs/architecture.md`:
  - Remove the "X-Dojo-Idempotency-Key — client-side correlation only" section.
  - Add a replacement § "Outbound request correlation" naming `X-Request-Id` + the OTel span attribute.
  - Add a forward pointer: "Real outbound deduplication is on the v2 roadmap; track it under the `outbound-deduper` capability."
- [ ] 4.2 Update `docs/sdk/client.md` § `RequestOptions` to document `requestId` with the correlation framing.
- [ ] 4.3 Update `MIGRATION.md` § "SDK: 0.8.x → 1.0.0" with the three-line rename diff (option, header, span attribute).
- [ ] 4.4 Update the `cloud-api-client` and `observability` specs (auto-applied by archive).

## 5. Phase 5 — ship `sdk-v0.9.0` (bundled with A2 + A3)

- [ ] 5.1 Land the change on `main`.
- [ ] 5.2 CHANGELOG entry under `## [0.9.0]` calls out:
  - The renames (option, header, span attribute).
  - Explicit "BREAKING (pre-1.0 minor)" marker.
  - Migration diff.
- [ ] 5.3 Archive: `openspec archive 2026-05-12-rename-idempotency-to-request-id`.
