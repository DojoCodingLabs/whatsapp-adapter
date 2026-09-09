# Change proposal — realign the Meta error taxonomy with Meta's error-code reference

Affected capabilities: `cloud-api-client` (error mapper, retry
exhaustion, span attributes) and `mcp-server` (recovery-hint
catalogue).

## Why

The September 2026 audit cross-checked `mapMetaError` against
Meta's Cloud API error-code reference and found four
misclassifications plus a contract break:

- `131053` ("Unable to upload the media used in the message") is a
  permanent content error, but the SDK retried it four times as a
  `RateLimitError` (F2).
- Meta's documented throttling codes `4` and `80007` — the ones
  hit by template-registry polling — fell through to `UNKNOWN`
  and were never retried (F7).
- Marketing opt-out (`131050`), the per-user marketing cap
  (`131049`), the newer enforcement codes (`131064`, `133016`),
  WhatsApp-specific permission code `131005`, auth code `0`, and
  the integrity group (`368`, `130497`, `131031`) all mapped to
  `UNKNOWN`, leaving consumers to parse `message` (F8, F9).
- `TemplateError` from Meta dropped the `132xxx` code, so
  "does not exist", "paused" and "param count" were
  indistinguishable (F10).
- Exhausted retries threw the internal `TransientHttpError`,
  a raw `TypeError` or `SyntaxError` — violating "errors are typed
  classes extending `WhatsAppError`" and contradicting
  `docs/compliance.md` (F5, F18).
- A caller's own `AbortSignal` was classified as a retryable
  `"abort"` failure: a pre-aborted signal scheduled three retries
  and slept the full jittered backoff (up to ~8 s) before the
  cancellation was honoured (F6, probe P3).

## What Changes

- `mapMetaError`: `131053`, `131008`, `131009`, `131051`, `131052`
  → `CapabilityError`; `4`, `80007` → retryable `RateLimitError`;
  `131049`, `131064`, `133016` → non-retryable `RateLimitError`;
  `131050` → `OptOutError("MARKETING", { metaCode })`; `0` →
  `AuthenticationError`; `3`, `10`, `131005` → `PermissionError`;
  `368`, `130497`, `131031` → new `AccountRestrictedError`;
  `132xxx` → `TemplateError` with `metaCode`.
- Transport: every error leaving `request()` is a `WhatsAppError`.
  Exhausted `429` / Meta throttling → `RateLimitError`; exhausted
  `408` / `5xx` → new `TransientError`; exhausted `fetch failed` →
  new `NetworkError`; `AbortError` → new `RequestAbortedError`;
  non-JSON `2xx` → `WhatsAppError("UNKNOWN")`, not retried.
- `whatsapp.error.meta_code` span attribute is emitted for every
  typed error that carries a `metaCode`.
- Retry: `RetryHooks.signal` (wired from `RequestOptions.signal`).
  A caller abort is never retried, cuts a pending backoff sleep
  short, and always surfaces as `RequestAbortedError` with the
  signal's `reason` as `cause`. Only non-caller `AbortError`s stay
  retryable with reason `"abort"`.
- MCP recovery hints for the new classes and the long-window
  rate-limit codes.
- `docs/compliance.md` § 4 table rewritten against Meta's table
  (fixes the `131026` / `131053` / `TransientHttpError` rows).

## Non-goals

- Changing retry timing or the default policy.
- Mapping every code in Meta's table; only codes with a distinct
  consumer action are typed.

## Impact

- `cloud-api-client`: 3× MODIFIED requirements.
- `mcp-server`: 1× MODIFIED requirement.
- Four new error classes, `WhatsAppErrorCode` grows by four
  literals, `TemplateError` / `OptOutError` gain `metaCode`.
- Behaviour change for consumers matching `131053` as
  `RateLimitError` → minor bump (`sdk-v0.10.0`).
