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

## Q2 2026 — `sdk-v0.9.0` + `mcp-v0.4.0`

| Item                            | Status                                    |
| ------------------------------- | ----------------------------------------- |
| Phase A integration audit fixes | ✅ Shipped in `sdk-v0.9.0` + `mcp-v0.4.0` |

## Q3 2026 — `sdk-v0.10.0` + `mcp-v0.5.0`

> **Version story (settled Sep 2026).** Earlier drafts of this page
> and the CHANGELOGs labelled this batch `sdk-v1.1.0` / `mcp-v1.1.0`
> on the assumption that `1.0.0` would already have shipped. It has
> not — the `1.0.0` tag is gated on a live smoke test against a real
> WABA (see Q4). Both packages therefore stay pre-1.0 and this batch
> ships as `sdk-v0.10.0` + `mcp-v0.5.0`. Minor bumps on `0.x` may
> carry breaking changes; each is called out in the CHANGELOG.

All items below ship in `sdk-v0.10.0` / `mcp-v0.5.0`.

| Item                                                                                                                                                                                                                           | Status                          | Capability touched                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------------------------------------- |
| MCP Streamable HTTP transport (`createWhatsAppHttpHandler`)                                                                                                                                                                    | ✅ `mcp-v0.5.0`                 | `mcp-server`                           |
| MCP bearer-auth (static token + verifyToken callback)                                                                                                                                                                          | ✅ `mcp-v0.5.0`                 | `mcp-server`                           |
| Retry telemetry (`whatsapp.retry.{count,reason}` span attrs + onRetry hook)                                                                                                                                                    | ✅ `sdk-v0.10.0`                | `observability`, `cloud-api-client`    |
| `OptInRegistry` capability (consent-gated template sends)                                                                                                                                                                      | ✅ `sdk-v0.10.0`                | NEW `opt-in-registry`                  |
| Bug fixes: window-closed error code (131047 not 131026), reactions window-gated, list total-rows ≤ 10                                                                                                                          | ✅ `sdk-v0.10.0`                | `cloud-api-client`, `message-builders` |
| `markAsRead` + `typing_indicator` (SDK convenience + MCP tool)                                                                                                                                                                 | ✅ `sdk-v0.10.0` + `mcp-v0.5.0` | NEW `conversation-acks`                |
| Media upload + two-step download (SDK primitive + MCP `get_media_info` / `upload_media_from_url` tools)                                                                                                                        | ✅ `sdk-v0.10.0` + `mcp-v0.5.0` | NEW `media`                            |
| New `UndeliverableError` typed class (131026)                                                                                                                                                                                  | ✅ `sdk-v0.10.0`                | `cloud-api-client`                     |
| `agent-bridge` primitive (`createAgentBridge` + `InMemoryAgentInbox` + default transform)                                                                                                                                      | ✅ `sdk-v0.10.0`                | NEW `agent-bridge`                     |
| Public `WebhookReceiver.dispatch(events)` for external-feed scenarios                                                                                                                                                          | 💡 Conditional                  | `webhook-receiver`                     |
| Cookbook batch (Sentry OTel, Supabase pgbouncer, Chat SDK coexistence, media caching)                                                                                                                                          | 🚧 On `main`                    | docs only                              |
| `SUPPORT.md` + `ROADMAP.md`                                                                                                                                                                                                    | ✅ `sdk-v0.10.0`                | docs only                              |
| **Sep 2026 deep audit** — see `docs/_internal/2026-09-07-sdk-deep-audit.md`                                                                                                                                                    | ✅ `sdk-v0.10.0` + `mcp-v0.5.0` | see below                              |
| · `whatsapp.path` span attribute no longer carries `?access_token=` (F1)                                                                                                                                                       | ✅                              | `observability`                        |
| · Meta error taxonomy realigned (`131053` → `CapabilityError`; new `AccountRestrictedError`, `TransientError`, `NetworkError`, `RequestAbortedError`, `MediaExpiredError`; exhausted retries always surface a `WhatsAppError`) | ✅                              | `cloud-api-client`                     |
| · Caller `AbortSignal` honoured mid-backoff; `signal.reason` preserved as `cause`                                                                                                                                              | ✅                              | `cloud-api-client`                     |
| · Template pre-flight: named `{{param}}` placeholders, media / location headers, button-index parsing                                                                                                                          | ✅                              | `template-management`                  |
| · `WindowTracker.notifyInbound(from, atMs)` honours the customer's timestamp                                                                                                                                                   | ✅                              | `window-tracker`, `agent-bridge`       |
| · `user_preferences` webhook → `UserPreferencesEvent`; `interactive_nfm_reply` + `request_welcome` kinds                                                                                                                       | ✅                              | `webhook-receiver`                     |
| · Media downloads through the transport pipeline (span, retry, `fetchImpl`, `MediaExpiredError`)                                                                                                                               | ✅                              | `cloud-api-client`, `media`            |
| · Builders pre-flight Meta's character limits (`MESSAGE_LENGTH_LIMITS`)                                                                                                                                                        | ✅                              | `message-builders`                     |
| · `StatusEvent.pricingType` / `pricingModel` / `billable` for Oct 1, 2026 per-message pricing                                                                                                                                  | ✅                              | `webhook-receiver`                     |
| · Graph API pin `v25.0` → `v26.0`                                                                                                                                                                                              | ✅                              | `cloud-api-client`                     |

## Q4 2026 — `sdk-v1.0.0` + `mcp-v1.0.0`, then `sdk-v1.1.0` + `mcp-v1.1.0`

The first stable releases of both packages. Pure stability
tags — no new code in `1.0.0` itself; all features land in
`0.x` and the `1.0.0` tag is the semver commitment. See
[`MIGRATION.md`](./MIGRATION.md) § "What v1.0.0 locks."

| Item                                                                                                                                                                                                                          | Status                                   | Capability             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------- |
| Live Meta smoke test against a real WABA                                                                                                                                                                                      | 📅 Q4 — needs user-provisioned test WABA | —                      |
| `sdk-v1.0.0` + `mcp-v1.0.0` stability tags                                                                                                                                                                                    | 📅 Q4 — gated on smoke test              | —                      |
| **Oct 1, 2026 per-message pricing** — the SDK already surfaces `StatusEvent.pricingType` / `billable`; consider a `FreeEntryPointTracker` (72 h CTWA window) alongside `WindowTracker` so orchestrators can budget sends.     | 💡 Considering                           | NEW `pricing`          |
| **`biz_opaque_callback_data`** on sends + status webhooks — Meta-native correlation id (up to 512 chars), more useful than the SDK's `X-Request-Id` for reconciling `StatusEvent`s to your own records.                       | 💡 Considering (audit F25)               | `message-builders`     |
| **`message_send_ttl_seconds`** on template sends (30 s – 30 d; authentication default 10 min).                                                                                                                                | 💡 Considering (audit F25)               | `message-builders`     |
| **`messaging_account_id`** (Jun 16, 2026) — `paid_messaging_account_id` is deprecated Dec 31, 2026; surface the new field on account-level events and the health check.                                                       | 📅 Q4 (audit F25)                        | `cloud-api-client`     |
| **Direct Send API** (open beta Jun 15, 2026) — utility / authentication sends without a pre-created template.                                                                                                                 | 💡 Considering (audit F25)               | `cloud-api-client`     |
| **Interactive kinds** `location_request_message`, `address_message`, `flow`, `product`, `product_list` builders.                                                                                                              | 💡 Considering (audit F25)               | `message-builders`     |
| **Template button sub-types** `flow`, `catalog`, `mpm`, `voice_call` in `validateTemplateSend`.                                                                                                                               | 💡 Considering (audit F25)               | `template-management`  |
| **Webhook fields** `account_update`, `message_echoes`, `calls`, `business_capability_update` — typed events (today they land in `unknown`, which is the correct forward-compat behaviour).                                    | 💡 Considering (audit F25)               | `webhook-receiver`     |
| **`dedupeAfterSuccess` receiver option** — opt-in at-least-once dispatch for consumers with idempotent handlers (today dedupe is before dispatch; see `docs/sdk/webhooks.md`).                                                | 💡 Considering (audit F22)               | `webhook-receiver`     |
| **Outbound deduper** — real outbound dedup keyed on `(phoneNumberId, recipient, payloadHash, ttl)`. Pluggable `Storage`-shaped backend. Drops the "rename idempotencyKey → requestId" v0.9 caveat that real dedup is post-v1. | 📅 Q4 (`1.1.0`)                          | NEW `outbound-deduper` |
| **CTWA helpers** — `MessageEvent.referral` is already exposed (`sdk-v0.9.0`). Q4 adds optional helpers for the CAPI handoff (signed-event signing, retry on CAPI 5xx).                                                        | 💡 Considering                           | `webhook-receiver`     |
| **Phone-validation helpers** — `validateE164({ country: "CR" })`, opt-in country-code defaults on builders. Low-priority per Site2Print's audit.                                                                              | 💡 Considering                           | `message-builders`     |
| **Pre-built JWT verifier for the MCP HTTP handler** — wraps `jose` against common identity providers (Auth0 / Cognito / Clerk). Sugar over the existing `verifyToken` callback.                                               | 💡 Considering                           | `mcp-server`           |

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
