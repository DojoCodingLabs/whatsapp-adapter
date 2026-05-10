## 1. Type surface

- [ ] 1.1 Define and export `type TokenProvider = () => string | Promise<string>` from `src/client/whatsapp-client.ts`.
- [ ] 1.2 Change `WhatsAppClientOptions.token` to `string | TokenProvider`.
- [ ] 1.3 Document the new shape in the JSDoc comment on the field.

## 2. Constructor

- [ ] 2.1 Update the `MissingCredentialsError` check: `token` is "missing" only when it is neither a non-empty string nor a function.
- [ ] 2.2 Store the token internally as `TokenProvider` (wrap a string in `() => string` at construction so the rest of the client is uniform).

## 3. Resolution

- [ ] 3.1 Replace `_getBearerToken(): string` with `_resolveBearerToken(): Promise<string>`. Resolve the callback, await if necessary, validate the result is a non-empty string, otherwise throw `AuthenticationError` with code `"AUTHENTICATION"` and a message describing the misuse ("token provider returned a non-string value" / "token provider returned an empty string" / "token provider threw").
- [ ] 3.2 Update every internal call site:
  - `src/client/transport.ts` line 141: `Authorization: Bearer ${await client._resolveBearerToken()}`.
  - `src/client/health.ts` line 41: same pattern.
- [ ] 3.3 Resolve the token INSIDE `doFetch`, not at the outer `request()` boundary, so retries within a single request use the same resolved value (avoid surprise re-resolution mid-retry).

## 4. Tests

- [ ] 4.1 Update `test/unit/client/whatsapp-client.test.ts` to test both the string overload and the callback overload at construction time. The existing `_getBearerToken` test becomes `_resolveBearerToken` and resolves to the same value.
- [ ] 4.2 Create `test/unit/client/token-provider.test.ts`:
  - sync callback returning a string is awaited and used.
  - async callback returning a Promise<string> is awaited and used.
  - callback fires on every request (not memoized) — verify by mounting a callback that increments a counter, making 3 requests, asserting counter === 3.
  - callback throwing surfaces as `AuthenticationError` BEFORE any fetch.
  - callback returning empty string surfaces as `AuthenticationError`.
  - callback returning non-string surfaces as `AuthenticationError`.
- [ ] 4.3 Update `test/contract/cloud-api-client/transport.test.ts` with one new scenario: callback-resolved token appears in the `Authorization: Bearer …` header.

## 5. Documentation

- [ ] 5.1 Update `docs/client.md` § "Options" with the new `token` shape and a small example using the callback.
- [ ] 5.2 Rewrite `docs/patterns.md` § 5 (Token rotation): demote the swap-the-client pattern to a footnote, promote the callback as primary.
- [ ] 5.3 Update `CHANGELOG.md` `[Unreleased]` with the new pattern and the breaking-but-source-compatible nature of the change.

## 6. Archive

- [ ] 6.1 Run `openspec validate --changes --strict`.
- [ ] 6.2 Push, wait for CI green per the release-discipline skill.
- [ ] 6.3 Tick all task checkboxes; commit.
- [ ] 6.4 `openspec archive add-token-provider-callback --yes`.
- [ ] 6.5 Commit the archive + spec deltas merge.
