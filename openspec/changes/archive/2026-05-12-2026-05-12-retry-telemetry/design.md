# Design — Retry telemetry

## Context

`packages/whatsapp-sdk/src/client/retry.ts` already implements
the full retry behaviour: exponential backoff with full jitter,
`Retry-After` honour, the classifier `shouldRetry` that decides
whether an error is retryable. What it doesn't do is surface
the classification or the count to consumers — the retry loop
is opaque from outside.

`packages/whatsapp-sdk/src/client/transport.ts` wraps every
Graph API call in `withSpan("whatsapp.request", ...)` and emits
a fixed set of attributes (`whatsapp.method`, `whatsapp.path`,
`whatsapp.phone_number_id`, `whatsapp.request.id`). On error,
`attachErrorAttributesToActiveSpan` adds `whatsapp.error.code`
and `whatsapp.error.meta_code`. There is no retry-related
attribute today.

This change adds retry visibility through a single mechanism
that serves three audiences:

1. **The SDK's own OTel span** — `whatsapp.retry.{count,reason}`
   on the `whatsapp.request` span.
2. **Consumer-side metrics / logging** — a new optional
   `onRetry` hook on `RetryHooks` that fires on every scheduled
   retry. Consumers wire their own counter / histogram /
   structured-log emitter.
3. **Future debuggers / replay tools** — the same `RetryInfo`
   shape (attempt, reason, delayMs, error) is the canonical
   per-retry observation; whatever we ship later
   (`outbound-deduper`, replay buffer, etc.) can hang off the
   same surface.

## Goals

- Make retry counts and classifications visible in OTel
  without a code change at every consumer call site.
- Allow consumers to plumb their own metrics into the same
  classification (counters keyed by `RetryReason`).
- Don't break the existing retry behaviour: the SDK still
  retries the same set of errors, with the same backoff math,
  with the same `Retry-After` honouring.
- Surface the actually-useful reason: distinguish "rate
  limited" from "5xx" from "network blip" without the consumer
  having to inspect raw error types.

## Non-Goals

- **Metrics-API integration in the SDK itself.** The SDK
  doesn't depend on `@opentelemetry/api-metrics`; spans alone
  are sufficient for the v1.1 release. Metrics derivation
  (counters, histograms) happens in the consumer's exporter or
  via a custom `onRetry` callback.
- **Per-attempt full request/response logging.** That's
  consumer-side, not in scope.
- **Replay buffering** — a separate v2 capability
  (`outbound-deduper`).
- **Per-retry span events.** OTel supports adding `Event`s to
  a span (`span.addEvent("retry", {...})`); we could do this
  in addition to the summary attributes. Skipped for v1.1 —
  the summary attributes cover 90% of dashboard needs and
  event-level visibility is a bigger surface to commit to
  under semver. Reconsider in v2 if consumer demand exists.

## Decisions

### 1. Why a `reason` discriminator, not raw error codes

Consumers want to filter / group dashboard data ("retries
due to rate limiting vs network blips"). The natural shape
is a small discriminated union. The four reasons cover every
retryable error class the SDK currently retries:

- `transient_http` — `TransientHttpError` with status ∈
  {408, 500, 502, 503, 504}
- `rate_limit` — `TransientHttpError` with status 429 OR
  `RateLimitError` (Meta's business error code 130429)
- `network` — `TypeError(fetch failed)` (DNS, TCP, TLS)
- `abort` — `AbortError` (consumer-supplied AbortSignal fired
  mid-request)

A future addition (e.g. a new Meta error code that gets
re-classified as retryable) extends this union with a new
literal — non-breaking under semver.

### 2. Why `RetryInfo` (not just `RetryReason`) on the hook

The hook is a public surface; consumers should be able to plumb
attempt number, delay, AND the raw error into their own
observability. Including the full `RetryInfo` shape costs
nothing structurally and gives consumers everything they could
want without a follow-up release.

### 3. Why classification happens in retry.ts, not transport.ts

`retry.ts` already has `shouldRetry(err)` — it knows which
error classes are retryable. Adding a sibling
`classifyRetryReason(err): RetryReason` next to it keeps the
"is retryable + why" logic co-located. `transport.ts` then
just consumes the classification.

### 4. Why the transport tracks state, not retry.ts

The retry helper is a pure function (modulo hooks). It
shouldn't know about OTel spans. The transport already lives
inside `withSpan` and already does
`attachErrorAttributesToActiveSpan` — adding retry-attribute
emission is a small, local addition.

### 5. Why `TransientHttpError.status` instead of parsing the message

Today `TransientHttpError`'s message is
`"Graph API ${response.status} (transient)"`. The classifier
COULD parse the status from the message — but that's brittle
(any message tweak breaks the classifier) and ugly.

Adding `status: number` as a public readonly field on the
class is minimal:

- Non-breaking — existing consumers don't construct
  `TransientHttpError` (it's an internal marker); even if
  they did, the constructor stays the same shape with the new
  field defaulting sensibly.
- Honest — the class is named `TransientHttpError`; carrying
  the HTTP status is the obvious shape.
- Useful — opens the door to future classifications (e.g.
  per-status retry policy) without another shape change.

### 6. Why span attributes ARE present on the success path

A successful request with `whatsapp.retry.count = 0` looks
the same as one with the attribute absent — but `count = 2`
is meaningful only if `count = 0` is also queryable. Setting
the attribute on every span gives dashboard authors a
queryable "average retry count" metric across all requests
(success and failure both). On the failure path, the
attribute additionally indicates whether the final failure
was preceded by retries.

### 7. Why `whatsapp.retry.reason` is only set when count > 0

Setting `reason` to an empty string or "none" when count is 0
wastes space and adds noise to dashboards. The reason
attribute is meaningful only when retries actually happened;
absent + count=0 conveys "no retries needed" cleanly.

### 8. Composing consumer-provided `onRetry` with the internal tracker

When `RequestOptions.retryHooks.onRetry` is supplied,
`transport.ts` composes it: the internal tracker fires first
(records to local state), then the consumer's hook fires
(forwarded the same `RetryInfo` value). Composition order is
documented but doesn't affect correctness — both hooks see
every retry exactly once.

### 9. Cleared retries on a fresh attempt

The retry counter is per-`request()` call. A subsequent
`request()` starts at 0; it does NOT inherit count from a
prior call. This matches consumer expectation (the span is
per-request; retry stats are per-span).

### 10. What about Workers / WinterCG runtimes

The retry telemetry uses no Node-specific APIs. OTel's
`trace.getActiveSpan()` works in any context where a tracer
is registered. No runtime-portability regression.
