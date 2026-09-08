## 1. Error classes

- [x] 1.1 `src/types/errors.ts`: add `ACCOUNT_RESTRICTED`, `TRANSIENT`, `NETWORK`, `ABORTED` to `WhatsAppErrorCode`.
- [x] 1.2 Add `AccountRestrictedError`, `TransientError`, `NetworkError`, `RequestAbortedError` (all with `Object.setPrototypeOf`).
- [x] 1.3 Add optional `metaCode` to `TemplateError` and `OptOutError`.
- [x] 1.4 Re-export the classes and meta types from `src/index.ts`; add them to the public-surface drift detector.
- [x] 1.5 Tests: hierarchy + discriminator + `cause` for every new class in `test/unit/types/errors.test.ts`.

## 2. Mapper

- [x] 2.1 `src/client/errors.ts`: split rate-limit codes into retryable (`4`, `80007`, `130429`, `131048`, `131056`) and non-retryable (`131049`, `131064`, `133016`) sets; export `isRateLimitMetaCode`.
- [x] 2.2 Move `131053` to `CAPABILITY_CODES`; add `131008`, `131009`, `131051`, `131052`.
- [x] 2.3 Add `0` to `AUTH_CODES`; `3`, `10`, `131005` to `PERMISSION_CODES`.
- [x] 2.4 Map `131050` → `OptOutError("MARKETING", { metaCode })`; `368`, `130497`, `131031` → `AccountRestrictedError`.
- [x] 2.5 `132xxx` → `TemplateError(message, undefined, { metaCode })`.
- [x] 2.6 Export `extractMetaCodeFromBody` for the transport.
- [x] 2.7 Tests: every new code in `test/unit/client/errors.test.ts`, including `isRetryableError === false` for the non-retryable set and for `131053`.

## 3. Transport

- [x] 3.1 `src/client/retry.ts`: `TransientHttpError` carries optional `metaCode`.
- [x] 3.2 `src/client/transport.ts`: parse Meta code into the transient marker; wrap non-JSON `2xx` as `WhatsAppError("UNKNOWN")` without retry.
- [x] 3.3 Add `toPublicError` at the retry boundary; structural `extractMetaCode`.
- [x] 3.4 Tests (`test/contract/cloud-api-client/transport.test.ts`): exhausted 503 → `TransientError`; exhausted 429 → `RateLimitError`; 429 + `80007` envelope → `RateLimitError(metaCode 80007)`; 200 + HTML → `UNKNOWN`, one call; `fetch failed` → `NetworkError`; aborted signal → `RequestAbortedError`.

## 4. MCP

- [x] 4.1 `packages/whatsapp-mcp/src/errors.ts`: hints for `AccountRestrictedError`, `TransientError`, `NetworkError`, `RequestAbortedError`; `131049` / `131064` branches on `RateLimitError`; `metaCode` surfaced for `TemplateError` / `OptOutError`.
- [x] 4.2 Tests in `packages/whatsapp-mcp/test/unit/errors.test.ts`.
- [x] 4.3 `docs/mcp/error-recovery.md` catalogue updated.

## 5. Docs

- [x] 5.1 `docs/compliance.md` § 4 table + catch pattern rewritten (fixes `131026` / `131053` / `TransientHttpError` rows).
- [x] 5.2 `docs/sdk/client.md`, `docs/sdk/patterns.md`, `docs/architecture.md`, `docs/compatibility.md` updated.
