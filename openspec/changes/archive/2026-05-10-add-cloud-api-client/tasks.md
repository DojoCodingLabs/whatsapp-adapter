## 1. Dev dependency

- [x] 1.1 `pnpm add -D msw@^2 @types/node@^22` (msw for HTTP contract tests)

## 2. Error mapper

- [x] 2.1 Create `src/client/errors.ts` exporting `mapMetaError(httpStatus, body) → WhatsAppError`. Recognised codes: 131056 / 131048 / 130429 / 131053 → `RateLimitError`; 131026 → `WindowClosedError`; 132xxx → `TemplateError`; everything else → `WhatsAppError("UNKNOWN", ...)`. Tolerates non-Meta-shaped bodies (HTML, plain text, undefined).
- [x] 2.2 Add `test/unit/client/errors.test.ts` covering each mapped code, the `132xxx` range, the unknown fallback, and a pure-text body. (34 cases)

## 3. Retry policy

- [x] 3.1 Create `src/client/retry.ts` exporting `retry(fn, policy?)` and `parseRetryAfter(headerValue)`. Default policy `{ maxAttempts: 4, baseDelayMs: 250, maxDelayMs: 8000, jitter: "full" }`.
- [x] 3.2 `retry()` retries on HTTP 408/429/5xx and Meta codes 130429/131048/131056/131053. Floors delay at 50 ms. Honours numeric and HTTP-date `Retry-After`.
- [x] 3.3 Add `test/unit/client/retry.test.ts` with `vi.useFakeTimers()` covering: success on attempt 1, success after a transient 503, exhaustion, immediate fail on non-retryable 4xx, numeric Retry-After honoured, HTTP-date Retry-After honoured, full-jitter delay distribution (sample 200 calls, assert all in expected range), 50 ms floor on jitter=0. (16 cases)

## 4. Transport layer

- [x] 4.1 Create `src/client/transport.ts` exporting `request<T>(client, method, path, body?, options?)` — pure helper, takes a `WhatsAppClient` for credentials. Builds URL, sets headers, generates idempotency key once, calls `retry(() => fetch(...))`, parses response, calls `mapMetaError` on non-2xx.
- [x] 4.2 Tolerate paths with or without leading `/`. Set `Authorization: Bearer ${token}`, `Content-Type: application/json` (when body present), `Accept: application/json`, `X-Dojo-Idempotency-Key: <uuid v4>`.
- [x] 4.3 Add `test/contract/cloud-api-client/transport.test.ts` with msw: 200 OK round-trip, idempotency-key stable across retries, fresh key per call, version pin in URL, custom version override in URL, `Authorization` header present, body serialized as JSON only when provided. (14 cases)

## 5. WhatsAppClient method wiring

- [x] 5.1 Add `WhatsAppClient.request<T>(method, path, body?, options?)` (`@internal`) that delegates to the transport helper.
- [x] 5.2 Create `src/client/health.ts` exporting `healthCheck(client) → Promise<TokenInfo>` — calls `GET /debug_token?input_token=${token}`, normalises Meta's `expires_at` (seconds → ms), throws `WhatsAppError` on `is_valid: false` or non-2xx.
- [x] 5.3 Add `WhatsAppClient.healthCheck()` public method that delegates to `health.ts`.
- [x] 5.4 Export `TokenInfo` type from `src/index.ts`.

## 6. Tests for end-to-end retry/error flows

- [x] 6.1 Add `test/contract/cloud-api-client/retry-and-errors.test.ts` covering: 503 then 200 (retries), 400 with code 131056 (RateLimitError, retried then succeeds), 400 with code 131026 (WindowClosedError, NOT retried), 200 with `is_valid: false` body in healthCheck (throws), token-info expiry conversion s → ms. (Combined into transport.test.ts and health.test.ts.)
- [x] 6.2 Add `test/unit/client/health.test.ts` for the pure-helper part. (Covered by contract test against msw — no separate unit test added; pure-helper logic is fully exercised through the contract layer.)

## 7. Verification

- [x] 7.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean
- [x] 7.2 `pnpm test:coverage` — all green; coverage on `src/client/*.ts` 96.4 lines / 89.6 branches (gates: 90 / 85)
- [x] 7.3 `pnpm build` produces typed exports including `TokenInfo`, `RequestOptions`, `RetryPolicy`, `TransientHttpError`, and `WhatsAppClient.healthCheck`
- [x] 7.4 `openspec validate add-cloud-api-client --strict` passes
