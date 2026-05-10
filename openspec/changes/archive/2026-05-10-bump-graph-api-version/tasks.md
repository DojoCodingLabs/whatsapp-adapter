## 1. Constant

- [x] 1.1 Update `src/types/constants.ts:1`: `GRAPH_API_VERSION = "v23.0"` → `"v25.0"`.

## 2. Tests

- [x] 2.1 Update `test/unit/types/constants.test.ts:13` to assert `"v25.0"`.
- [x] 2.2 Update `test/contract/cloud-api-client/transport.test.ts` — every `captureHandler("v23.0", ...)` and every URL string `https://graph.facebook.com/v23.0/...` becomes `v25.0`.
- [x] 2.3 Update `test/contract/message-builders/send.test.ts` and `test/contract/message-builders/convenience-methods.test.ts` similarly.
- [x] 2.4 Update `test/contract/observability/transport-spans.test.ts` similarly.

## 3. Spec deltas

- [x] 3.1 Update `openspec/changes/bump-graph-api-version/specs/cloud-api-client/spec.md` with the modified-requirement deltas.

## 4. Docs

- [x] 4.1 `docs/architecture.md`: outbound-flow diagram swaps `graph.facebook.com/v23.0/...` → `v25.0`.
- [x] 4.2 `docs/mock.md`: example option comment swaps the version literal.
- [x] 4.3 `docs/compliance.md`: § 1 enforcement table and § 3.1 divergence both update / remove.

## 5. Verification

- [x] 5.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [x] 5.2 `pnpm test` passes.
- [x] 5.3 `openspec validate bump-graph-api-version --strict` passes.

## 6. Archive

- [x] 6.1 `openspec archive bump-graph-api-version` to merge the spec deltas into `openspec/specs/cloud-api-client/spec.md`.
