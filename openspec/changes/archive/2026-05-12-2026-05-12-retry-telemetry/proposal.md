# Change proposal — Retry telemetry on the `whatsapp.request` span

## Why

The SDK's HTTP transport (`packages/whatsapp-sdk/src/client/transport.ts`)
already retries transient failures with exponential backoff and
full jitter — but the retry loop is **invisible to consumers'
observability**. A request that hit a 429 twice and finally
succeeded looks identical to a request that succeeded on the
first attempt: same span, same status, same wamid. Operators
can't see the per-call retry count, can't surface "is Meta
rate-limiting us today?" dashboards, and can't correlate user-
facing latency spikes back to retry storms.

Site2Print explicitly called this out in the integration audit
(B6.2 "rate limit + retry telemetry"). They run marketing
broadcasts that approach Meta's per-WABA rate ceiling and need
visibility into the retry loop — counters for 429s, backoff
sleeps, final failures.

This change is the smallest viable addition: two new attributes
on the existing `whatsapp.request` OTel span, populated by the
existing retry helper, surfaced via a new public hook so
downstream consumers can plumb the same data into their own
metrics if they prefer.

No breaking surface change. The `whatsapp.request` span name
and its existing attributes are unchanged.

## What Changes

### Added — `RetryReason` discriminated string

```ts
export type RetryReason =
  | "transient_http" // 408 / 5xx; the most common
  | "rate_limit" // 429 HTTP OR Meta business error code 130429
  | "network" // fetch failed (TypeError) — DNS, TCP, TLS
  | "abort"; // AbortSignal fired mid-request
```

Exported from the package root. Consumers writing custom
`onRetry` hooks (below) discriminate on this.

### Added — `RetryHooks.onRetry?: (info) => void`

```ts
interface RetryHooks {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /**
   * Invoked once per scheduled retry — AFTER the failure is
   * classified as retryable, BEFORE the backoff sleep. Use to
   * record per-retry telemetry. The retry helper does NOT await
   * the return value.
   */
  onRetry?: (info: RetryInfo) => void;
}

interface RetryInfo {
  attempt: number; // 1-indexed; the attempt that just failed
  reason: RetryReason;
  delayMs: number; // sleep that will happen before the next attempt
  error: unknown; // the caught error
}
```

### Added — span attributes on `whatsapp.request`

Two new attributes set on every `whatsapp.request` span, on
both the success and the error path:

- **`whatsapp.retry.count: number`** — count of retry attempts
  AFTER the first call. `0` when the first attempt succeeded.
- **`whatsapp.retry.reason: RetryReason`** — set ONLY when
  `whatsapp.retry.count > 0`; carries the classification of the
  most recent retry.

The span name, the existing attributes (`whatsapp.method`,
`whatsapp.path`, `whatsapp.phone_number_id`,
`whatsapp.request.id`), and the existing error attributes
(`whatsapp.error.code`, `whatsapp.error.meta_code`) are
unchanged.

### Internal: `transport.ts` wires `onRetry`

The transport layer hooks `onRetry` to track local
`retryCount` / `retryReason` state, then sets the span
attributes inside the `withSpan` block after the retry
completes (success or final failure).

If the consumer also supplies an `onRetry` via
`RequestOptions.retryHooks.onRetry`, the transport invokes
theirs after its own internal tracker — both observers see
every retry.

### Internal: `TransientHttpError.status`

Adds a public readonly `status: number` field to the existing
`TransientHttpError` so the retry classifier can distinguish
429 (rate-limit) from other transient HTTP statuses (5xx,
408). Existing consumers that construct `TransientHttpError`
won't break — the new field is added at the end of the
constructor's parameter list with a sensible default if
omitted.

## Impact

- **observability capability:** 1× MODIFIED requirement on the
  span-attribute surface (`whatsapp.request` gains
  `whatsapp.retry.{count,reason}`).
- **cloud-api-client capability:** 1× MODIFIED requirement on
  the retry-policy section (adds the `onRetry` hook + the
  `RetryReason` classification + the `TransientHttpError.status`
  field).
- **Release impact:** `sdk-v1.1.0` (minor, additive). Ships as
  the first post-1.0 minor.
- **Stability:** the new span attributes and the `onRetry` hook
  are part of the v1 stability commitment from `sdk-v1.1.0`
  onwards. Span attributes can be added non-breakingly under
  semver per MIGRATION.md.
- **Breaking?** No. Adding optional fields to `RetryHooks` and
  adding span attributes are both non-breaking. Adding a public
  field to `TransientHttpError` is non-breaking. The only
  behavioural change is that consumer code reading
  `TransientHttpError` instances at runtime sees a new field.
