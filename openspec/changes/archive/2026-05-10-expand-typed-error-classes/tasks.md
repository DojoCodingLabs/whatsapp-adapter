## 1. New typed-error classes

- [x] 1.1 Widen `WhatsAppErrorCode` in `src/types/errors.ts` with `"AUTHENTICATION" | "PERMISSION" | "CAPABILITY"`.
- [x] 1.2 Add `AuthenticationError` (carrying optional `metaCode` and `subcode`), `PermissionError` (optional `metaCode`), `CapabilityError` (optional `metaCode`) subclasses with prototype-chain set-up via `Object.setPrototypeOf`.
- [x] 1.3 Re-export the three classes from `src/index.ts`.

## 2. Mapper extension

- [x] 2.1 Update `src/client/errors.ts` `mapMetaError`:
  - Add `AUTH_CODES = new Set([190])`; map → `AuthenticationError`, carrying `error_subcode`.
  - Add `PERMISSION_CODES = new Set([200, 210, 230, 294, 299])`; map → `PermissionError`.
  - Add `CAPABILITY_CODES = new Set([100])`; map → `CapabilityError`.
  - Order the checks BEFORE the `132xxx` and final `UNKNOWN` fallback.
- [x] 2.2 Confirm `isRetryableError` still rejects all three new classes (no behaviour change — they don't have `metaCode` in `RETRYABLE_RATE_LIMIT_CODES`).

## 3. Unit tests

- [x] 3.1 Extend `test/unit/types/errors.test.ts`:
  - `AuthenticationError` → `instanceof WhatsAppError && instanceof Error`; `code === "AUTHENTICATION"`; `subcode` field round-trips.
  - `PermissionError` → same instanceof; `code === "PERMISSION"`; `metaCode` field round-trips.
  - `CapabilityError` → same instanceof; `code === "CAPABILITY"`; `metaCode` field round-trips.
- [x] 3.2 Extend `test/unit/client/errors.test.ts`:
  - 190 maps → `AuthenticationError`, metaCode === 190, subcode preserved when present.
  - 200, 210, 230, 294, 299 each map → `PermissionError` with metaCode set.
  - 100 maps → `CapabilityError`, metaCode === 100.
  - 191 maps → `WhatsAppError("UNKNOWN", …)` (out-of-set; verifies set-membership, not range).
  - 132012 still maps → `TemplateError` (regression check for the template range).

## 4. Spec deltas

- [x] 4.1 Update `openspec/changes/expand-typed-error-classes/specs/cloud-api-client/spec.md` with the modified `Meta error-code mapper` requirement and added scenarios.

## 5. Docs

- [x] 5.1 `docs/compliance.md` § 4 error-code coverage: add the three new typed mappings to the table.
- [x] 5.2 `docs/compliance.md` § 3.3: replace divergence with a "Resolved" note; add the `catch` recommendation for the new classes.
- [x] 5.3 `docs/client.md` § "Error mapping" table: add three new rows.

## 6. Verification

- [x] 6.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [x] 6.2 `pnpm test` passes.
- [x] 6.3 `openspec validate expand-typed-error-classes --strict` passes.

## 7. Archive

- [x] 7.1 `openspec archive expand-typed-error-classes`.
