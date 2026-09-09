## Why

`StatusEvent` lifts only `pricing.category` (as `pricingCategory`, with a JSDoc that wrongly describes it as the pricing model) and `conversation.id`. Since Graph API v24.0 Meta omits the `conversation` object on most statuses (per-message pricing), and from **Oct 1, 2026** every free-form message and in-window UTILITY template is billed per message — only the 72 h free entry-point window stays free. The field that tells a consumer *which* bucket a message fell into is `pricing.type` (`regular` | `free_customer_service` | `free_entry_point`), together with `pricing.billable`. Neither is surfaced today, so invoice reconciliation requires reaching into `raw`. Audit findings F19 + F24 in `docs/_internal/2026-09-07-sdk-deep-audit.md`.

## What Changes

- **ADDED** `StatusEvent.pricingType?: string`, `StatusEvent.pricingModel?: string`, `StatusEvent.billable?: boolean`, lifted from `statuses[i].pricing.{type,pricing_model,billable}` when present and of the expected primitive type; omitted (not `undefined`-assigned) otherwise.
- **MODIFIED** JSDoc on `StatusEvent.conversationId` / `pricingCategory` to describe what Meta actually sends.
- **MODIFIED** JSDoc on `WhatsAppClientOptions.windowTracker` — only templates are window-exempt; `sendReaction` is gated (F19).
- **MODIFIED** `docs/sdk/webhooks.md` (new "StatusEvent pricing fields" table; "Dedupe happens before dispatch" section — F22), `docs/compliance.md` § 2 (Oct 1, 2026 pricing, `user_preferences`, handler retries — F24), `ROADMAP.md` (version story — F20; platform-surface candidates — F25).
- New fixture `test/__fixtures__/webhooks/status-sent-pmp.json` (PMP-shaped status without `conversation`).

## Capabilities

### Modified Capabilities

- `webhook-receiver`: `StatusEvent` gains three optional fields. Purely additive; existing fields unchanged.

## Non-goals

- No 72 h free-entry-point tracker (roadmap Q4 2026).
- No `dedupeAfterSuccess` option (roadmap; documented as a design decision instead).

## Impact

- **Code:** three parser lines + three interface fields.
- **Tests:** two new parser cases + one fixture.
- **Risk:** none — additive optional fields.
