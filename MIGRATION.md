# Migration guide

This document covers upgrades between **major versions** of each
package in the workspace. Both packages follow
[Semantic Versioning](https://semver.org); pre-1.0 minor versions
may contain breaking changes (the per-package
[`CHANGELOG`](./packages/whatsapp-sdk/CHANGELOG.md) labels these
explicitly).

For the standard release workflow (tagging, npm publish with
provenance), see [`CONTRIBUTING.md`](./CONTRIBUTING.md) § Releases.

## What v1.0.0 locks

Each package crosses `1.0.0` independently. After the bump:

- The **public exports** documented in [`docs/sdk/`](./docs/sdk/)
  (SDK) and [`docs/mcp/`](./docs/mcp/) (MCP server) are stable
  under the standard semver contract. Breaking changes require a
  major bump.
- The **typed error classes** (`WhatsAppError` and its 9
  subclasses) are stable. Existing `instanceof` checks continue
  to work for the life of the major line.
- The **OpenSpec capability surface** (10 capabilities, 73
  requirements under [`openspec/specs/`](./openspec/specs/)) is
  stable. Adding requirements is non-breaking; removing or
  weakening a requirement requires a major bump.
- **`@deprecated` JSDoc tags** signal v2 removal candidates.
  Anything marked deprecated as of `1.0.0` remains functional
  through the 1.x line and is removed in `2.0.0` at the earliest.

What is **not** covered by the semver promise:

- Anything tagged `@internal` in JSDoc.
- Anything imported from a private subpath the package's
  `package.json` `exports` map does not expose.
- The MCP server's **stdio is the only transport.** Streamable
  HTTP is on the v2 roadmap (see
  [`docs/mcp/transports.md`](./docs/mcp/transports.md)) but not
  guaranteed stable until the major bump.
- Test-only exports (`_resetRedactSaltForTests`, etc.).

## SDK: `0.8.x` → `1.0.0`

The SDK's public surface at `0.8.x` is the target for `1.0.0`.
The 0.x → 1.x cut is small — most consumers can upgrade with no
code changes. The deprecations and additions below land on the
final `0.8.z` patch so you can adopt them before the major bump.

### Renames (already shipped in 0.8.0)

If you are still on `@dojocoding/whatsapp@<0.8.0>`, the rename
landed at `0.8.0`:

```diff
- import { WhatsAppClient } from "@dojocoding/whatsapp";
+ import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
```

Subpath exports renamed identically: `/express`, `/web`, `/hono`,
`/storage/redis`, `/storage/postgres`. The npm `dojocoding/whatsapp`
package is deprecated with a redirect; no behaviour change between
`@dojocoding/whatsapp@0.7.4` and `@dojocoding/whatsapp-sdk@0.8.0`.

### Deprecations cleared at `1.0.0`

#### `setRedactSalt(...)` — prefer the per-client option

The process-wide `setRedactSalt(...)` helper for OTel PII redaction
is **deprecated as of `0.8.3`** in favour of a constructor-scoped
option on `WhatsAppClient` and `WebhookReceiver`:

```diff
- import { setRedactSalt, WhatsAppClient } from "@dojocoding/whatsapp-sdk";
- setRedactSalt(process.env.OBSERVABILITY_SALT!);
- const client = new WhatsAppClient({ phoneNumberId, wabaId, token, appSecret });
+ import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
+ const client = new WhatsAppClient({
+   phoneNumberId,
+   wabaId,
+   token,
+   appSecret,
+   redactSalt: process.env.OBSERVABILITY_SALT,
+ });
```

```diff
- import { setRedactSalt, WebhookReceiver } from "@dojocoding/whatsapp-sdk";
- setRedactSalt(process.env.OBSERVABILITY_SALT!);
- const receiver = new WebhookReceiver({ appSecret, verifyToken });
+ import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
+ const receiver = new WebhookReceiver({
+   appSecret,
+   verifyToken,
+   redactSalt: process.env.OBSERVABILITY_SALT,
+ });
```

The setter continues to work through the 1.x line as a process-wide
fallback. It is removed in v2.0.0 — multi-tenant deployments
**must** migrate to the constructor option, since a single
process-wide salt cannot be scoped to a specific WABA-phone pair
and lets spans from different tenants be cross-correlated by
comparing hash prefixes.

`hashPhoneNumberId(value)` continues to work unchanged; an
optional second argument `hashPhoneNumberId(value, salt)` lets
callers (including custom `WhatsAppLikeClient` wrappers) pass
their own salt through the SDK's tracing pipeline.

### Removed (none planned at `1.0.0`)

No exports are removed at the `1.0.0` cut. Every public symbol
documented in [`docs/sdk/`](./docs/sdk/) at `0.8.x` is present
unchanged at `1.0.0`.

### Stability tiers inside the SDK

| Surface                                                                                                                                | Stability                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WhatsAppClient`, `WebhookReceiver`, builders                                                                                          | Stable. Locked under semver at `1.0.0`.                                                                                                                                                              |
| `WhatsAppLikeClient` interface                                                                                                         | Stable. New optional members may be added (non-breaking). The drift detector (`test/contract/client-interface-drift.test.ts`) catches accidental real-vs-mock divergence.                            |
| Typed errors (`WhatsAppError` and 9 subclasses)                                                                                        | Stable.                                                                                                                                                                                              |
| Constants (`GRAPH_API_VERSION`, etc.)                                                                                                  | Stable as exports. The underlying value (e.g. `"v25.0"`) tracks Meta's Cloud API releases — bumps to a newer pinned version land as a **minor** SDK release, per `openspec/specs/cloud-api-client/`. |
| Storage adapters (`InMemoryStorage`, Redis, Postgres)                                                                                  | Stable. The `Storage` interface is locked; specific TTL contract documented in [`docs/sdk/storage.md`](./docs/sdk/storage.md).                                                                       |
| Framework adapters (`/express`, `/web`, `/hono`)                                                                                       | Stable.                                                                                                                                                                                              |
| OTel spans (`whatsapp.*` names + attributes)                                                                                           | Span **names** are stable. Span **attributes** may grow (non-breaking); removing or renaming an attribute is a major bump.                                                                           |
| `setRedactSalt`                                                                                                                        | **Deprecated** at `0.8.3`. Functional through 1.x; removed in 2.0.                                                                                                                                   |
| Anything imported via a `src/` deep path                                                                                               | Not stable. Use only the public exports listed in `packages/whatsapp-sdk/src/index.ts` (re-exported from the package root).                                                                          |
| `@internal` JSDoc-tagged exports (`WhatsAppClient._resolveBearerToken`, `WebhookReceiver._dispatchEvents`, `_resetRedactSaltForTests`) | Not stable. May change in any release.                                                                                                                                                               |

## MCP server: `0.3.x` → `1.0.0`

The MCP server crosses `1.0.0` with the **send-only surface**
defined in `openspec/specs/mcp-server/spec.md`: 16 outbound
tools, 2 read-only resources, 1 prompt, stdio transport. The
inbound surface (webhook receiver) is not in MCP v1 — agents that
need to react to inbound traffic pair the MCP server with the
SDK's `WebhookReceiver` (see
[`docs/cookbook/hybrid/`](./docs/cookbook/hybrid/)).

### What's new in `0.4.0` — embedded toolset

`@dojocoding/whatsapp-mcp@0.4.0` adds
[`createWhatsAppToolset`](./docs/mcp/embedded.md) — a flat,
callable API exposing the same 16 tools / 2 resources / 1
prompt without instantiating an MCP `Server` or binding to a
transport. Useful for:

- Vercel serverless / Cloudflare Workers / AWS Lambda — where
  long-lived stdio child processes aren't an option.
- Merging the WhatsApp tool surface into an **outer MCP
  gateway** that already serves multiple upstreams under one
  endpoint (with one auth boundary).
- Dispatching tools from non-MCP code — Vitest, queue workers,
  HITL operator UIs.

The toolset shares per-tool `{ definition, handler }` pairs
with the stdio `WhatsAppMcpServer`; surface parity is enforced
at CI time by
`packages/whatsapp-mcp/test/contract/embedded-toolset-parity.test.ts`.
This addition is non-breaking — existing stdio consumers see
zero change.

The toolset surface is **stable** at `1.0.0` under the same
semver promise as the stdio surface: tool names, resource URIs,
prompt names, and `inputSchema` JSON-Schema serialisations are
locked. See [`docs/mcp/embedded.md`](./docs/mcp/embedded.md) §
"Stability commitment" for the full matrix.

### Tool / resource / prompt name stability

The names exported as constants from
`packages/whatsapp-mcp/src/index.ts` (`SEND_TEXT_TOOL`,
`WINDOW_RESOURCE_URI_TEMPLATE`, etc.) are **stable** at `1.0.0`.
Renames require a major bump. Adding new tools/resources/prompts
is non-breaking.

### Tool schema stability

Each tool's `inputSchema` (zod schema) is part of the public
surface. Adding **optional** fields is non-breaking; making a
field required, renaming a field, or changing its type requires
a major bump. The contract suite in
`packages/whatsapp-mcp/test/contract/public-surface.test.ts`
enforces this on every PR.

### Error response shape stability

The canonical error shape — `isError: true` +
`structuredContent.error.{code, message, recoveryHint}` — is
stable at `1.0.0`. Error **codes** (e.g. `window_closed`,
`auth_failed`) and **recovery hints** are part of the surface
the LLM consumes. New codes may be added (non-breaking); existing
codes may not be renamed without a major bump.

The catalogue lives at
[`docs/mcp/error-recovery.md`](./docs/mcp/error-recovery.md).

### Env var / CLI flag stability

The env vars and CLI flags documented at
[`docs/mcp/auth.md`](./docs/mcp/auth.md) are stable at `1.0.0`.
Adding new optional configuration is non-breaking; renaming or
removing an existing var requires a major bump.

### MCP v2 (planned, not in scope for `1.0.0`)

- **Streamable HTTP transport.** Stdio is the only transport at
  `1.0.0`. The plan for a Streamable HTTP transport (MCP spec
  revision `2025-06`, OAuth-protected) is documented in
  [`docs/mcp/transports.md`](./docs/mcp/transports.md). When it
  ships, it lands as a minor bump (additive) and the stdio path
  stays unchanged.
- **Inbound surface.** Webhook delivery to MCP hosts isn't
  feasible over stdio. A separate `@dojocoding/whatsapp-mcp-server`
  HTTP-mode package may ship in the future; until then, pair
  the MCP server with the SDK's webhook receiver (the hybrid
  cookbook).

## Pre-flight checklist before bumping

Before tagging `sdk-v1.0.0` or `mcp-v1.0.0`:

- [ ] `pnpm -r test` — every package green.
- [ ] `pnpm -r typecheck` — no new diagnostics.
- [ ] `pnpm -r lint` — no warnings.
- [ ] `pnpm -r build` then `pnpm -r size` — bundles under budget.
- [ ] `openspec validate --strict` — no active changes.
- [ ] CHANGELOG entry for the new version exists and the
      `release.yml` workflow's "Verify CHANGELOG entry exists"
      step will pass.
- [ ] One real-world smoke test against a Meta test WABA — send
      one `hello_world` template through `WhatsAppClient` and
      capture the resulting `wamid` in the release notes. The
      contract suite is 100% MSW-mocked; a live smoke run is the
      one signal the test suite cannot give you.
- [ ] Tag follows the `<package>-vX.Y.Z` convention
      (`sdk-v1.0.0` or `mcp-v1.0.0`); the release workflow
      derives the target package from the tag prefix.
