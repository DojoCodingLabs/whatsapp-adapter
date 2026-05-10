## Why

Phase 0 stubbed the `cloud-api-client` capability with construction and constants. Subsequent phases (`message-builders`, `template-management`, `webhook-receiver`) all need the same four primitives to do anything real: an authenticated Graph HTTP request, a retry policy that knows about Meta's error codes, an error-code-to-typed-error mapper, and a client-side idempotency key. Folding all four into one capability slice means later phases can compose them without re-litigating retry semantics.

This change extends the `cloud-api-client` capability with an internal `request()` method, a public `healthCheck()` method, a retry policy with exponential backoff plus jitter, a Meta-error-code → typed-error mapper, and client-side idempotency-key generation. No message-type-specific behavior — that lives in `message-builders` (Phase 2) and `template-management` (Phase 5).

## What Changes

- **NEW** `WhatsAppClient.request<T>(method, path, body?, options?)` (internal) — executes an authenticated Graph API call against `${META_GRAPH_BASE_URL}/${graphApiVersion}/${path}`, handles retry, parses JSON, returns typed response or throws a typed error.
- **NEW** `WhatsAppClient.healthCheck()` — calls `/debug_token` to verify the bearer token is valid and not expired; returns a typed `TokenInfo` or throws.
- **NEW** retry policy module under `src/client/retry.ts`: `retry(fn, policy)` with default policy `{ maxAttempts: 4, baseDelayMs: 250, maxDelayMs: 8000, jitter: "full" }`. Retries on HTTP 408/429/5xx and Meta error codes 130429, 131048, 131056, 131053. Honors `Retry-After` header (seconds or HTTP date).
- **NEW** error-code mapper under `src/client/errors.ts`: `mapMetaError(httpStatus, body) → WhatsAppError` mapping 131056 → `RateLimitError`, 131048 → `RateLimitError` (spam-detection), 130429 → `RateLimitError` (generic), 131026 → `WindowClosedError`, 132xxx range → `TemplateError`, others → `WhatsAppError("UNKNOWN", …)`.
- **NEW** client-side idempotency-key generation: every `request()` attaches `X-Dojo-Idempotency-Key: <uuid v4>` (kept identical across retries of the same logical call). Meta does not honor it, but we use it for our own logs/dedupe.
- **NEW** dev dependency: `msw@^2` for HTTP contract tests under `test/contract/cloud-api-client/**`.

## Capabilities

### Modified Capabilities
- `cloud-api-client`: adds the four new requirement groups above. Existing requirements (construction, version pin) are unchanged.

### New Capabilities
None.

## Non-goals

- **No message builders**: `request()` is type-erased on the body; the builders in Phase 2 own message shapes.
- **No webhook handling**: `webhook-receiver` (Phase 3) owns inbound.
- **No 24h-window enforcement at the request level**: `WindowClosedError` is mapped from Meta's `131026` only after a request fails. Pre-flight enforcement lives in Phase 4 (`window-tracker`).
- **No streaming, no multipart, no file uploads**: media-upload helpers are deferred (Phase 2 / future).
- **No automatic token refresh**: `healthCheck()` reports expiry; rotation is the consumer's responsibility (Phase 1.x or external job).
- **No global rate limiter**: per-WABA throughput limits live in a future change; Phase 1 handles only response-driven retry.

## Impact

- **Code**: net-new modules `src/client/{transport.ts,retry.ts,errors.ts,health.ts}`. `src/client/whatsapp-client.ts` gets two methods bolted on. `src/index.ts` re-exports `TokenInfo`.
- **APIs**: `WhatsAppClient.healthCheck()` becomes part of the public surface. `request()` is `@internal` and not re-exported from `src/index.ts`.
- **Dependencies**: `msw@^2` added under `devDependencies`. No new runtime deps (uses global `fetch` from Node 20+ and `crypto.randomUUID()`).
- **Systems**: contract tests run against an in-process `msw` server — no real network.
