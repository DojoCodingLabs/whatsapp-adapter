## Why

The SDK pins `GRAPH_API_VERSION = "v25.0"` in `packages/whatsapp-sdk/src/types/constants.ts:1`. Meta released Graph API `v26.0` on 2026-07-29 (see the [version table](https://developers.facebook.com/docs/graph-api/changelog/versions/)). `v25.0` remains callable until 2028-07-29, so nothing is broken, but a new SDK release should target the current version so fresh consumers don't inherit a stale default — and so any `v26.0`-only WhatsApp Cloud API feature is reachable without a per-instance override.

The `v26.0` changelog carries no WhatsApp Cloud API breaking changes (the breaking entries are Commerce Order Management, Marketing API placement removals and Delivery Estimate fields), so the bump is a pure pin change. Audit finding F17 in `docs/_internal/2026-09-07-sdk-deep-audit.md`.

## What Changes

- **MODIFIED** `packages/whatsapp-sdk/src/types/constants.ts`: `GRAPH_API_VERSION = "v25.0"` → `"v26.0"`.
- **MODIFIED** `openspec/specs/cloud-api-client/spec.md`: the three literal `v25.0` mentions (construction scenario, constant requirement, URL-construction scenarios) become `v26.0`.
- **MODIFIED** hardcoded msw handler / assertion URLs across `packages/whatsapp-sdk/test/contract/`, `packages/whatsapp-sdk/test/parity/`, `packages/whatsapp-sdk/test/unit/types/constants.test.ts` and `packages/whatsapp-mcp/test/unit/env.test.ts` (~80 sites).
- **MODIFIED** the stale `// (Graph API v23)` header comment in `packages/whatsapp-sdk/src/messages/types.ts` (audit F17 sub-finding).
- **MODIFIED** docs that cite the version: `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`, `docs/compliance.md`, `docs/sdk/client.md`, `docs/sdk/mock.md`, `docs/mcp/auth.md`.

## Capabilities

### Modified Capabilities

- `cloud-api-client`: pinned default version bumps; per-instance override behaviour unchanged.

## Non-goals

- **No SDK behaviour change beyond the version pin.**
- **No support-policy commitment** to track Meta's release cadence; future bumps land via further OpenSpec changes.
- **No backwards-compat shim.** Consumers who want `v25.0` pass it via `graphApiVersion`.

## Impact

- **Code:** one constant + one comment.
- **Tests:** ~80 literal updates; zero behaviour change.
- **Risk:** low. Both `v25.0` and `v26.0` are callable; downgrade is one option away.
