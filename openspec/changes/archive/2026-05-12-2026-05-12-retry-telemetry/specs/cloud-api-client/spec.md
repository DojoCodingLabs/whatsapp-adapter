## MODIFIED Requirements

### Requirement: Retry policy with exponential backoff and full jitter

The SDK SHALL retry transient failures using exponential
backoff with full jitter, honouring `Retry-After` when
present, and SHALL classify retryable failures into a small
discriminated set surfaced via `RetryReason`.

`RetryReason` is exported from the package root:

```ts
export type RetryReason =
  | "transient_http" // 408 / 500 / 502 / 503 / 504
  | "rate_limit" // 429 HTTP OR Meta error code 130429
  | "network" // fetch failed (DNS, TCP, TLS)
  | "abort"; // AbortSignal fired mid-request
```

`RetryHooks` SHALL accept an optional `onRetry` callback:

```ts
interface RetryInfo {
  attempt: number; // 1-indexed; the attempt that just failed
  reason: RetryReason;
  delayMs: number; // backoff before the next attempt
  error: unknown; // the caught error
}

interface RetryHooks {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: RetryInfo) => void;
}
```

The `onRetry` hook SHALL be invoked exactly once per scheduled
retry — AFTER the SDK classifies the error as retryable, BEFORE
the backoff sleep. The retry helper SHALL NOT await the hook's
return value (synchronous side-effect only).

When both the SDK's internal retry tracker (used for OTel span
attributes) and a consumer-provided `onRetry` are active, the
internal tracker SHALL fire FIRST, then the consumer hook with
the same `RetryInfo` value. Exceptions thrown by the consumer
hook SHALL NOT break the retry loop (the SDK catches and
silently drops them; the retry proceeds).

`TransientHttpError` SHALL carry a public readonly `status:
number` field naming the HTTP status of the response that
triggered the error. The classifier uses this to distinguish
429 (→ `"rate_limit"`) from other transient statuses
(→ `"transient_http"`).

The SDK SHALL export `classifyRetryReason(err: unknown):
RetryReason | undefined` so consumers writing custom retry
shims can replicate the same classification.

#### Scenario: `onRetry` fires with the same RetryInfo the SDK uses internally

- **GIVEN** a `WhatsAppClient.request(...)` call with a consumer-supplied `retryHooks.onRetry`
- **WHEN** the first attempt fails with a 429 and the retry helper schedules a retry
- **THEN** the consumer's `onRetry` SHALL be invoked exactly once
- **AND** the `RetryInfo.attempt` SHALL be `1`
- **AND** the `RetryInfo.reason` SHALL be `"rate_limit"`
- **AND** the `RetryInfo.delayMs` SHALL be > 0
- **AND** the `RetryInfo.error` SHALL be the caught `TransientHttpError` instance

#### Scenario: Consumer hook throwing does not break retry

- **GIVEN** an `onRetry` that throws an Error
- **WHEN** the first attempt fails with a 503
- **THEN** the SDK SHALL still sleep and retry the call
- **AND** the consumer's exception SHALL be silently dropped (not propagated to the final result)

#### Scenario: TransientHttpError carries the originating status

- **WHEN** Meta returns HTTP 503 and the transport throws
- **THEN** the caught error SHALL be an instance of `TransientHttpError`
- **AND** `error.status` SHALL equal `503`

#### Scenario: `classifyRetryReason` returns `"rate_limit"` for 429 and 130429

- **WHEN** `classifyRetryReason(new TransientHttpError("...", undefined, 429))` is called
- **THEN** the return value SHALL be `"rate_limit"`
- **AND** when `classifyRetryReason(new RateLimitError("...", { metaCode: 130429 }))` is called
- **THEN** the return value SHALL ALSO be `"rate_limit"`
