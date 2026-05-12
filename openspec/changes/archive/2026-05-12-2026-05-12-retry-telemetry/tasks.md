## 1. Phase 1 — retry.ts surface additions

- [ ] 1.1 Add `export type RetryReason = "transient_http" | "rate_limit" | "network" | "abort";` to `packages/whatsapp-sdk/src/client/retry.ts`.
- [ ] 1.2 Add `export interface RetryInfo { attempt: number; reason: RetryReason; delayMs: number; error: unknown; }`.
- [ ] 1.3 Add `onRetry?: (info: RetryInfo) => void` to `RetryHooks`. JSDoc explains: fires once per scheduled retry, after classification, before backoff sleep. Return value is not awaited.
- [ ] 1.4 Add `status: number` field to `TransientHttpError`. Default to `0` when omitted from the constructor for backward compatibility.
- [ ] 1.5 Implement `export function classifyRetryReason(err: unknown): RetryReason | undefined;` returning:
  - `"rate_limit"` for `RateLimitError` OR `TransientHttpError.status === 429`
  - `"transient_http"` for other `TransientHttpError`
  - `"network"` for `TypeError(fetch failed)`
  - `"abort"` for `AbortError`
  - `undefined` for non-retryable errors (won't be retried; not classified)
- [ ] 1.6 In the `retry()` loop, when an error is classified as retryable and a retry is scheduled, invoke `hooks.onRetry?.({ attempt, reason, delayMs, error })` BEFORE `await sleep(...)`.
- [ ] 1.7 Run existing retry unit + property tests — confirm no behaviour change.

## 2. Phase 2 — transport.ts wires retry tracking onto the span

- [ ] 2.1 In `packages/whatsapp-sdk/src/client/transport.ts` `request()`, before the `withSpan` call, declare local trackers: `let retryCount = 0; let retryReason: RetryReason | undefined;`.
- [ ] 2.2 Compose a wrapped `onRetry` that updates the trackers AND forwards to any consumer-provided `options.retryHooks?.onRetry`. Internal updates first, then the consumer hook (documented order).
- [ ] 2.3 After `retry()` resolves (success path), call a new private `attachRetryAttributesToActiveSpan(retryCount, retryReason)` helper that does:
  - `span.setAttribute("whatsapp.retry.count", retryCount)`
  - `if (retryReason !== undefined) span.setAttribute("whatsapp.retry.reason", retryReason)`
- [ ] 2.4 After `retry()` throws (final-failure path), the catch block ALSO calls `attachRetryAttributesToActiveSpan` (in addition to the existing `attachErrorAttributesToActiveSpan`).
- [ ] 2.5 Update `transport.ts` to throw `TransientHttpError(message, retryAfterMs, response.status)` so the status field is populated for the classifier.

## 3. Phase 3 — exports

- [ ] 3.1 Add `RetryReason`, `RetryInfo`, and `classifyRetryReason` to the re-exports in `packages/whatsapp-sdk/src/index.ts`.
- [ ] 3.2 Update the SDK public-surface drift detector (if any) to include the new exports.

## 4. Phase 4 — tests

- [ ] 4.1 Add `packages/whatsapp-sdk/test/contract/cloud-api-client/retry-telemetry.test.ts`:
  - `whatsapp.retry.count = 0` on a first-attempt success
  - `whatsapp.retry.count = 2` + `reason = "transient_http"` after two 503 retries
  - `reason = "rate_limit"` after a 429 retry (TransientHttpError path)
  - `reason = "rate_limit"` after a `RateLimitError` retry (Meta business code 130429 path)
  - `reason = "network"` after a `TypeError("fetch failed")` retry
  - `reason = "abort"` after an `AbortError` retry
  - `whatsapp.retry.reason` is ABSENT when count is 0 (assert via `getAttribute`)
  - Span attributes set on the FAILURE path too (final attempt throws → span still has retry.count + reason)
- [ ] 4.2 Add `packages/whatsapp-sdk/test/unit/client/retry-classify.test.ts` covering each branch of `classifyRetryReason`.
- [ ] 4.3 Add `packages/whatsapp-sdk/test/contract/cloud-api-client/onretry-hook.test.ts`:
  - Consumer-provided `onRetry` receives the same `RetryInfo` for every retry
  - Consumer's hook fires AFTER the SDK's internal tracker (composition order is documented but doesn't affect correctness)
  - Throwing in the consumer hook does NOT break retry (the SDK swallows hook errors)
- [ ] 4.4 Add unit test asserting `new TransientHttpError("x", 100, 429).status === 429`.

## 5. Phase 5 — docs

- [ ] 5.1 Update `docs/sdk/observability.md` § "Spans + attributes" with the two new attributes (name, type, semantic).
- [ ] 5.2 Update `docs/sdk/client.md` § `RequestOptions` / retryHooks to document the new `onRetry` hook with the canonical Honeycomb / Sentry / OTel-metrics consumer recipe.
- [ ] 5.3 Add a CHANGELOG `[1.1.0]` placeholder entry in `packages/whatsapp-sdk/CHANGELOG.md` (filled when sdk-v1.1.0 ships — for now, the change archives under `[Unreleased]`).

## 6. Phase 6 — ship as part of `sdk-v1.1.0`

- [ ] 6.1 Land the change on `main`. Archive: `openspec archive 2026-05-12-retry-telemetry`.
- [ ] 6.2 Coordinated `sdk-v1.1.0` release bundles this with the other Phase B SDK changes (`outbound-deduper`, retry telemetry, OTel + Sentry walkthrough doc, etc.).
- [ ] 6.3 Verify the new attributes show up in a real OTel backend (Honeycomb / Sentry / etc.) — sanity check post-release.
