# Design — realign the Meta error taxonomy

## Chosen approach

Keep `mapMetaError` a pure code → class lookup, but split the
rate-limit family into two sets: `RETRYABLE_RATE_LIMIT_CODES`
(clears in seconds — `4`, `80007`, `130429`, `131048`, `131056`)
and `NON_RETRYABLE_RATE_LIMIT_CODES` (hours/days or per-recipient —
`131049`, `131064`, `133016`). Both produce `RateLimitError`, so
the consumer's "queue it" branch is unchanged; `isRetryableError`
only returns `true` for the first set, so the SDK's backoff budget
is not burned on limits it cannot outwait.

The transport gains a single `toPublicError(err, attempts)` at the
retry boundary:

```
retry() throws ──▶ WhatsAppError?          ──▶ pass through
                   TransientHttpError 429 / Meta throttle code
                                           ──▶ RateLimitError { metaCode?, retryAfterMs?, cause }
                   TransientHttpError other ──▶ TransientError { httpStatus, attempts, retryAfterMs?, cause }
                   AbortError               ──▶ RequestAbortedError { cause }
                   TypeError "fetch failed" ──▶ NetworkError { cause }
                   anything else            ──▶ WhatsAppError("UNKNOWN", { cause })
```

`TransientHttpError` gains an optional `metaCode` (parsed from the
body of a 429/5xx that carried a Meta envelope) so the upgrade to
`RateLimitError` preserves the code. A `2xx` whose body fails
`response.json()` is thrown as `WhatsAppError("UNKNOWN")` inside
`doFetch` — it is deliberately NOT retryable, because for
`POST /messages` the send most likely succeeded.

`extractMetaCode` for the span attribute becomes structural
(`"metaCode" in err`) so `TemplateError`, `OptOutError` and
`AccountRestrictedError` are picked up without a per-class branch.

Domain rules satisfied:

- "Errors are typed classes extending `WhatsAppError`" — now true
  for the retry-exhaustion, network and cancellation paths.
- "Every external API call gets an OTel span; `whatsapp.error.meta_code`"
  — emitted for all Meta-originated typed errors.
- "Never silently catch and swallow" — every wrap keeps the
  original as `cause`.

## Alternatives considered

- One `FrequencyCapError` for `131049`: rejected — it is a
  recipient-scoped rate limit; `RateLimitError` + `metaCode` keeps
  the consumer branch count down.
- `MediaError` for `131053`: rejected — the failure is "the
  request cannot be served as sent", which is `CapabilityError`'s
  contract; `131051`/`131052` join it for the same reason.
- Retrying non-JSON `2xx`: rejected — double-send risk.
