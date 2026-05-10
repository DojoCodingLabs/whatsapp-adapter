## Context

The current `WhatsAppClient` resolves the bearer token once at
construction and reuses the cached string for the lifetime of the
instance. Real production deployments rotate tokens for several
reasons:

- System User tokens have a 60-day expiry.
- Operations rotate proactively on suspected leak.
- A 401 from Graph API ("`code 190 / subcode 463`" — token expired)
  forces a refresh from the secret manager.

The documented pattern today (`docs/patterns.md` § 5) is to swap the
`WhatsAppClient` instance atomically per tenant. Concretely, that
means a per-tenant `Map<string, WhatsAppClient>` and a `replaceClient`
call that overwrites the entry. The race window is brief but real:
a request that started against the old client may complete its retry
loop on a token already revoked.

A callback turns rotation into "the next request reads the new
value from your secret manager". No instance swap, no race window.

Domain rules this design must satisfy:

- **Zero global state.** The callback is owned by the consumer; the
  client holds a reference. No singleton, no per-process cache.
- **Errors are typed.** A callback that throws or returns a
  non-string value must surface as a typed error before the HTTP
  call.
- **Per-request observability.** OTel spans already wrap each Graph
  call; the resolved-token step is logically part of that span.

## Goals / Non-Goals

**Goals:**

- Accept `token: string | () => string | Promise<string>` in
  `WhatsAppClientOptions`. The string overload preserves the
  common-case ergonomics; the function overload unlocks rotation.
- Resolve the token per request. Never cache the result inside the
  SDK — caching is the consumer's choice via their callback.
- Validate the resolved token shape before invoking `fetch`:
  reject empty strings and non-string returns with a clean
  `AuthenticationError`.
- Update `docs/patterns.md` § 5 to recommend the callback as the
  primary path and demote the instance-swap to a "legacy" footnote.

**Non-Goals:**

- An automatic refresh-on-401 retry. Application code can wrap the
  callback in their own "rotate then retry" logic; the SDK doesn't
  re-resolve mid-retry.
- A built-in token cache. Callers who want one wrap it in their
  callback.
- App-secret rotation via the same mechanism. App secrets rotate
  rarely enough that the swap pattern is acceptable for them.

## Decisions

### Decision: `token` becomes `string | TokenProvider`, not just `TokenProvider`

**Rationale.** A pure callback API would force every consumer to
write `token: () => MY_TOKEN`, which is busy-work for the 95% case
where the token doesn't rotate. Accepting both is one extra type
guard in the constructor and saves friction at every call site.

**Alternatives considered.** A separate `tokenProvider` option that
shadows `token` when present — doubles the surface; `token` is the
field everyone already knows.

### Decision: resolve per request, not per "send"

**Rationale.** Every Graph API call (`request`, `healthCheck`, future
`listTemplates`, etc.) goes through `transport.ts` `doFetch`. Resolving
at `doFetch` time captures all of them — including pre-flight checks
like `healthCheck` and the template list. A "resolve per send" hook
on the send methods only would miss those.

**Alternatives considered.** Resolve once per outermost public API
call — fails for `healthCheck` which doesn't go through `send*`.
Resolve once per `WithRetry` block — adds complexity and means the
retry uses the same stale token, which is the wrong default if the
401 is because of expiry.

### Decision: callback errors surface as `AuthenticationError`

**Rationale.** A callback that throws or returns garbage is, from
the SDK's perspective, an authentication failure. The consumer's
recovery path is the same as for a 401 from Graph (rotate the
secret manager value, retry). Using `AuthenticationError` keeps the
typed-error contract intact.

**Alternatives considered.** Letting the callback's error propagate
verbatim — surprising for consumers who wrote a generic catch on
`WhatsAppError`. Wrapping it in `WhatsAppError` with no subclass —
loses the granularity that justifies the typed hierarchy.

### Decision: remove `_getBearerToken()`, add `_resolveBearerToken()`

**Rationale.** The sync getter cannot exist when the value may be
async. The new method is internal; no documented consumer depends
on the sync shape. The convention `_underscore` for `@internal` is
preserved.

**Alternatives considered.** Keep the sync getter alongside a new
async one — drift; eventually some call site uses the wrong one.

## Control flow

```
consumer calls client.sendText({ to, body })
  │
  ▼
buildText → sendMessage → client.request("POST", "/messages", ...)
  │
  ▼
withSpan("whatsapp.request") opens
  │
  ▼
doFetch:
  await client._resolveBearerToken()
    ├─ token is string → return token as-is
    └─ token is function → await it; type-check the result;
                            throw AuthenticationError on
                            empty / non-string / thrown error
  │
  ▼
fetch(url, { headers: { Authorization: `Bearer ${resolved}`, ... } })
```

## Risks

- **Callback latency.** A callback that hits a secret manager
  synchronously per request is slow. The SDK doesn't cache; consumers
  who care must cache. Document this clearly.
- **Token leaks into the wrong span attribute.** The resolved token
  must NEVER appear on an OTel span. Existing spans only set
  `hashPhoneNumberId(...)`, `method`, `path`, `idempotency_key` —
  none contain the token. Safe.
- **Type-narrowing footguns.** Consumers writing `if (options.token
  === undefined)` instead of using the new shape. The TS type makes
  this a typecheck failure; runtime check on construction also
  catches it.

## Test layers

- **Unit**: `test/unit/client/whatsapp-client.test.ts` and a new
  `test/unit/client/token-provider.test.ts` covering:
  - Construction with `token: string` works as before.
  - Construction with `token: () => "tok"` works.
  - Construction with `token: async () => "tok"` works.
  - Construction with `token: () => ""` does not throw at
    construction (validation deferred to first request).
  - First request resolves the callback, sends `Authorization:
    Bearer tok`.
  - Callback fires fresh on every request (not memoized).
  - Callback throwing surfaces as `AuthenticationError` before the
    fetch.
  - Callback returning non-string surfaces as `AuthenticationError`.
- **Contract**: existing `test/contract/cloud-api-client/transport.test.ts`
  scenarios already cover the auth-header behaviour; one new
  scenario asserts the callback path produces the same header.
- **Documentation**: `docs/patterns.md` § 5 example becomes a
  typechecked snippet via the eventual `docs/__check__/` mechanism;
  for this change, just keep it correct manually.
