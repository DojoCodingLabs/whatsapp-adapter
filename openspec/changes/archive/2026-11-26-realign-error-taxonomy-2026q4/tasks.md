## 1. Error classes

- [x] 1.1 `src/types/errors.ts`: `UndeliverableError` gains `metaCode` and `reason` (`UNREACHABLE` | `RECIPIENT_BLOCKED`); the blocked message omits the recipient.
- [x] 1.2 `TransientError` gains optional `metaCode`; JSDoc for `AccountRestrictedError`, `CapabilityError`, `PermissionError`, `AuthenticationError`, `RateLimitError`, `TemplateError` updated.
- [x] 1.3 Export `UndeliverableErrorMeta` / `UndeliverableReason` types from `src/index.ts`.

## 2. Mapper

- [x] 2.1 `src/client/errors.ts`: move `131048` to the non-retryable throttle set; add `131066`.
- [x] 2.2 Add the `TRANSIENT_CODES` set → `TransientError({ metaCode, httpStatus })`; `isRetryableError` true for those; export `isTransientMetaCode`.
- [x] 2.3 `130403` → `UndeliverableError(RECIPIENT_BLOCKED)`; `131026` carries `metaCode`.
- [x] 2.4 `131042`, `33`, `131037`, `131045`, `133010` → `AccountRestrictedError`.
- [x] 2.5 `131021`, `131063`, `131065` → `CapabilityError`; `134102` → `TemplateError`.
- [x] 2.6 `200` → `AuthenticationError`; `201`–`299` range → `PermissionError`.
- [x] 2.7 Canonical error-code URL in the source comment.
- [x] 2.8 Tests (`test/unit/client/errors.test.ts`): every new code, `isRetryableError === false` for each non-retryable one, `300` stays `UNKNOWN`, `130403` message has no phone number.

## 3. Transport

- [x] 3.1 `src/client/transport.ts` `doFetch`: map the Meta envelope before status classification; throw non-retryable typed errors on the first attempt; route temporary codes through `TransientHttpError`.
- [x] 3.2 `toPublicError`: carry `metaCode` onto `TransientError`.
- [x] 3.3 Contract tests (`test/contract/cloud-api-client/meta-envelope-on-5xx.test.ts`, msw, fixtures in `test/__fixtures__/errors/`): 500 + `134102` → `TemplateError`, one call; 500 + `131042` → `AccountRestrictedError`, one call; 503 + `131016` → `TransientError(metaCode)`, four calls; 500 + unmapped code → transient as before; 429 + `131048` → `RateLimitError`, one call, `Retry-After` kept; 429 + `130429` still retried; 400 + `131000` retried; 400 + `131057` recovers; 400 + `130403` → `UndeliverableError`, one call, no number in the message.

## 4. Queue

- [x] 4.1 `src/queue/with-rate-limit.ts`: `perPhone` option keyed by `phoneNumberId`; `perWaba` kept as a deprecated alias; hashed `whatsapp.queue.phone_number_id` span attribute.
- [x] 4.2 Tests: alias honoured, `perPhone` wins over `perWaba`, two phone numbers on one WABA do not share a bucket, span attribute is hashed (`test/contract/outbound-queue/*.test.ts`).

## 5. Docs

- [x] 5.1 `openspec/config.yaml`: v26.0, window code 131047, drop the stale MCP out-of-scope line.
- [x] 5.2 `.github/ISSUE_TEMPLATE/compliance_drift.yml`: v26.0.
- [x] 5.3 `docs/cookbook/sdk/outbound-only.md`: 131047 → `WindowClosedError`, 131026 → `UndeliverableError`.
- [x] 5.4 `docs/compliance.md`: pricing in past tense with the 1,000 free service messages per number, § 3.3 coverage note, § 4 table + canonical URL, § 4.1 known upcoming changes, § 5 MCP line.
- [x] 5.5 `docs/sdk/client.md`, `docs/sdk/queue.md`, `docs/sdk/patterns.md`, `docs/architecture.md`.
- [x] 5.6 `packages/whatsapp-sdk/CHANGELOG.md` `[Unreleased]` entries (Breaking / Added / Deprecated).
