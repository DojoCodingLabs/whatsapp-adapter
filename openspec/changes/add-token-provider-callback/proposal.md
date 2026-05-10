## Why

`WhatsAppClientOptions.token` is currently a `string` — fixed at
construction. Tenants whose tokens rotate (System User token expiry,
manual rotation in Business Manager, an `AuthenticationError` triggering
a refresh) must either:

1. Cache one `WhatsAppClient` per tenant and swap the whole instance
   atomically on rotation — the pattern documented in
   [`docs/patterns.md`](../docs/patterns.md) § 5 today, and the source of
   real-life "swap a hash, lock for a tick, in-flight requests fall on
   either side" bugs; or
2. Mutate the token field via undocumented surgery (not safe).

A `TokenProvider` callback closes the gap. The client resolves the
token immediately before each Graph API request, so rotation becomes
"update the source of truth your callback reads from" — no instance
swap, no in-flight race window. Same shape consumers already use for
`@aws-sdk/credential-providers`, `Octokit({ auth: () => string })`,
`Stripe({ apiKey: async () => ... })`. Familiar pattern; trivial wins.

## What Changes

- **MODIFIED** `WhatsAppClientOptions.token`: now `string | () =>
  string | Promise<string>`. The string overload remains for the
  common single-tenant case.
- **MODIFIED** `WhatsAppClient` internals: `_getBearerToken()` is
  replaced by `_resolveBearerToken(): Promise<string>`. Every callsite
  (`transport.ts`, `health.ts`) awaits the resolved token per request.
- **MODIFIED** `src/client/transport.ts`: `Authorization: Bearer ${...}`
  uses the resolved per-request token.
- **MODIFIED** `src/client/health.ts`: same.
- **MODIFIED** `src/types/errors.ts`: `MissingCredentialsError` field
  detection allows either a non-empty string or a function for `token`.
- **MODIFIED** `docs/client.md` and `docs/patterns.md` § 5: replace the
  "swap the client atomically" pattern with the callback pattern.
- **NEW** unit tests:
  - Callback fires once per request (not memoized across requests).
  - Callback throwing causes the send to throw with the underlying
    error wrapped.
  - Callback returning empty string or non-string throws an
    `AuthenticationError`-shaped error before the HTTP call.
  - Existing `_getBearerToken()` is removed; all internal call sites
    are updated.
- **MODIFIED** `CHANGELOG.md` `[Unreleased]` (becomes `[0.4.0]`).

## Capabilities

### Modified Capabilities

- `cloud-api-client`: the construction-options requirement is widened
  to accept a callback, the auth-header requirement is rewritten to
  describe per-request resolution, and a new requirement
  documents the rotation pattern. The credential-validation
  requirement is updated so `token` may be a function (validated as
  "is a function" instead of "is a non-empty string").

### New Capabilities

None.

## Non-goals

- **Token-refresh primitive baked into the SDK.** The SDK does not
  schedule refreshes, store cached tokens, or talk to any identity
  provider. The callback is consumer-owned; if the consumer wants to
  cache for 50 minutes and refresh on minute 51, that's their
  callback's job.
- **Retry on `AuthenticationError`.** Already covered by the retry
  policy and by application-layer "rotate then retry" patterns. This
  change does not introduce automatic re-resolution on auth failure
  (a future spike).
- **App-secret rotation** via a similar callback. App secrets rotate
  far less often, and the current consumer-swap pattern is acceptable.
  Could be a follow-up if asked for.

## Impact

- Public API: **breaking** for any consumer that passes a non-string
  value to `token` today (none, since the type was `string`). The
  string path remains unchanged, so most consumers see zero diff.
- `_getBearerToken()` was `@internal`. Renaming it is internal-only
  surface; no documented consumers depend on the sync shape.
- Bundle size: negligible — one async resolution and one type guard.
- Runtime: one extra await per Graph API request. Async overhead is
  dominated by the actual HTTP call.
