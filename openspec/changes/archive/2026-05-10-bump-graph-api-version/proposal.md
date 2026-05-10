## Why

The SDK pins `GRAPH_API_VERSION = "v23.0"` in `src/types/constants.ts:1`. As of 2026-05-10, Meta's most recent Graph API version is `v25.0`. Versions remain callable for at least two years from release, so `v23.0` is still live, but a new SDK should target the current version so new consumers don't inherit a stale default — and so any v24+ feature (additional message types, expanded error responses, etc.) is available without overriding the constructor option per-call.

This change bumps the pinned default to `v25.0`. The constructor's `graphApiVersion?: GraphApiVersion` override remains, so consumers who deliberately want `v23.0` for cross-version migration testing can opt back.

## What Changes

- **MODIFIED** `src/types/constants.ts`: `GRAPH_API_VERSION = "v23.0"` → `"v25.0"`.
- **MODIFIED** `openspec/specs/cloud-api-client/spec.md`: scenario "Construction without `graphApiVersion`" updates the literal from `"v23.0"` to `"v25.0"`; the `Pinned Graph API version` requirement updates the example version; URL-construction scenarios update to `https://graph.facebook.com/v25.0/...`.
- **MODIFIED** test fixtures and msw URL handlers across `test/contract/cloud-api-client/`, `test/contract/message-builders/`, and `test/contract/observability/` to expect `v25.0`.
- **MODIFIED** `test/unit/types/constants.test.ts`: `expect(GRAPH_API_VERSION).toBe("v23.0")` → `"v25.0"`.
- **MODIFIED** docs that cite the version: `docs/architecture.md`, `docs/mock.md`, `docs/compliance.md`.

## Capabilities

### Modified Capabilities

- `cloud-api-client`: pinned default version bumps; per-instance override behaviour unchanged.

## Non-goals

- **No SDK behaviour change beyond the version pin.** No new message types, no new error mappings — those land in their own changes.
- **No support-policy commitment.** This change does not promise to track Meta's monthly cadence. Future bumps land via further OpenSpec changes when a version-specific need arises.
- **No backwards-compat shim.** The previous default (`v23.0`) is not preserved in any flag; consumers who rely on `v23.0` must pass it explicitly via `graphApiVersion`.

## Impact

- **Code:** one constant change; no behaviour change beyond the URL the transport hits.
- **Tests:** ~17 hardcoded `v23.0` literals across contract tests update to `v25.0`. One unit assertion changes.
- **Specs:** 4 literal updates in `cloud-api-client/spec.md`.
- **Docs:** 4 literal updates in `docs/`.
- **Risk:** low. The Graph API URL scheme is stable; the override path is unaffected. Consumers who rely on the default get whatever Meta serves at `v25.0`. Since both `v23.0` and `v25.0` are currently callable, downgrade to `v23.0` is one option override away.
