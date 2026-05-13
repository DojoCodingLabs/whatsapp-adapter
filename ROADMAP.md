# Roadmap

Quarter-level targets for the WhatsApp adapter workspace.
This page is **forward-looking** — items can slip, get
reprioritised, or drop entirely. The CHANGELOG is the ground
truth for what shipped.

For the stability commitment around each major, see
[`SUPPORT.md`](./SUPPORT.md).

## Status legend

- ✅ **Shipped.** In a published version.
- 🚧 **In flight.** Code on `main`, ships in the named upcoming release.
- 📅 **Committed.** Scoped, prioritised, expected in the named quarter.
- 💡 **Considering.** Not yet committed; we'd ship if a consumer needs it.
- ❌ **Out of scope.** Will not ship; here so consumers don't ask twice.

## Q2 2026 — `sdk-v1.0.0` + `mcp-v1.0.0`

The first stable releases of both packages. Pure stability
tags — no new code in `1.0.0` itself; all features land in
`0.x` / `0.4.x` and the `1.0.0` tag is the semver
commitment. See [`MIGRATION.md`](./MIGRATION.md) § "What
v1.0.0 locks."

| Item                                     | Status                                    |
| ---------------------------------------- | ----------------------------------------- |
| Phase A integration audit fixes          | ✅ Shipped in `sdk-v0.9.0` + `mcp-v0.4.0` |
| Live Meta smoke test against a real WABA | 📅 Q2 — needs user-provisioned test WABA  |
| `sdk-v1.0.0` stability tag               | 📅 Q2 — gated on smoke test               |
| `mcp-v1.0.0` stability tag               | 📅 Q2 — gated on smoke test               |

## Q3 2026 — `sdk-v1.1.0` + `mcp-v1.1.0`

First post-stability minor. All non-breaking additions.

| Item                                                                                  | Status                              | Capability touched                  |
| ------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------- |
| MCP Streamable HTTP transport (`createWhatsAppHttpHandler`)                           | 🚧 On `main`; ships in `mcp-v1.1.0` | `mcp-server`                        |
| MCP bearer-auth (static token + verifyToken callback)                                 | 🚧 On `main`; ships in `mcp-v1.1.0` | `mcp-server`                        |
| Retry telemetry (`whatsapp.retry.{count,reason}` span attrs + onRetry hook)           | 🚧 On `main`; ships in `sdk-v1.1.0` | `observability`, `cloud-api-client` |
| `OptInRegistry` capability (consent-gated template sends)                             | 🚧 On `main`; ships in `sdk-v1.1.0` | NEW `opt-in-registry`               |
| Public `WebhookReceiver.dispatch(events)` for external-feed scenarios                 | 💡 Conditional                      | `webhook-receiver`                  |
| Cookbook batch (Sentry OTel, Supabase pgbouncer, Chat SDK coexistence, media caching) | 🚧 On `main`                        | docs only                           |
| `SUPPORT.md` + `ROADMAP.md`                                                           | 🚧 On `main`                        | docs only                           |

## Q4 2026 — `sdk-v1.2.0` + `mcp-v1.2.0`

| Item                                                                                                                                                                                                                          | Status         | Capability             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------- |
| **Outbound deduper** — real outbound dedup keyed on `(phoneNumberId, recipient, payloadHash, ttl)`. Pluggable `Storage`-shaped backend. Drops the "rename idempotencyKey → requestId" v0.9 caveat that real dedup is post-v1. | 📅 Q4          | NEW `outbound-deduper` |
| **CTWA helpers** — `MessageEvent.referral` is already exposed (`sdk-v0.9.0`). Q4 adds optional helpers for the CAPI handoff (signed-event signing, retry on CAPI 5xx).                                                        | 💡 Considering | `webhook-receiver`     |
| **Phone-validation helpers** — `validateE164({ country: "CR" })`, opt-in country-code defaults on builders. Low-priority per Site2Print's audit.                                                                              | 💡 Considering | `message-builders`     |
| **Pre-built JWT verifier for the MCP HTTP handler** — wraps `jose` against common identity providers (Auth0 / Cognito / Clerk). Sugar over the existing `verifyToken` callback.                                               | 💡 Considering | `mcp-server`           |

## 2027 — `sdk-v2.0.0`

The first major bump. **Breaking changes that have been
queued behind `@deprecated` markers since `1.0.0`** land
here. Migration is documented in `MIGRATION.md`.

| Removal                              | Replaced by                                          | Deprecated since |
| ------------------------------------ | ---------------------------------------------------- | ---------------- |
| `setRedactSalt(salt)` (process-wide) | `WhatsAppClientOptions.redactSalt` per-client option | `sdk-v0.8.3`     |
| `(reserve)`                          | `(reserve)`                                          | —                |

Other shape changes that may land in v2:

- **Resource-server-mode MCP auth** — formal OAuth 2.1 / RFC
  8707 integration in the HTTP handler. The current
  `verifyToken` callback is the v1 escape hatch; a built-in
  resource-server flow with PKCE / introspection / token
  refresh would replace it as the recommended path.
- **Tightening of `MessageEvent.body`** — currently typed as
  `Record<string, unknown>` for forward-compat. v2 may
  narrow per-type with breaking changes.

## Out of scope (will not ship)

| Item                                            | Reason                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ❌ WhatsApp Web reverse-engineered library      | Different trust model entirely. We wrap Meta's Cloud API.                                            |
| ❌ Calls / Voice API                            | Different Meta product; out of scope for this SDK.                                                   |
| ❌ Embedded Signup / onboarding UI              | Token provisioning is consumer-side; we consume tokens.                                              |
| ❌ SSE (`HTTP+SSE`) MCP transport               | Deprecated upstream per MCP spec `2024-11-05`. We don't ship a wrapper.                              |
| ❌ Hard-coded STOP-keyword auto-opt-out         | Locale variance + per-tenant policy. The pattern is documented; the implementation is consumer-side. |
| ❌ Built-in consent UI / opt-in collection flow | Consent acquisition is consumer-side. We provide the registry primitive only.                        |
| ❌ Multi-WABA per `WhatsAppClient` instance     | "One client per WABA-phone pair" is a hard invariant. Multi-WABA = N clients.                        |

## How to influence the roadmap

- **Open an issue.** Quarter-level targets are responsive to
  real consumer needs. A clear use case with a deployment
  shape attached moves items from 💡 to 📅.
- **Submit a PR.** The interface surfaces are documented in
  the per-capability spec. A PR that fits the existing
  patterns (OpenSpec proposal first, then code) lands fast.
- **Cite a specific blocker.** "We need X by Q3 because Y" is
  the most useful framing — concrete enough to prioritise.

## See also

- [`SUPPORT.md`](./SUPPORT.md) — support window for each
  major.
- [`MIGRATION.md`](./MIGRATION.md) — upgrade paths between
  majors.
- The per-package CHANGELOG (ground truth for what shipped).
- `openspec/specs/` — current capability surface.
