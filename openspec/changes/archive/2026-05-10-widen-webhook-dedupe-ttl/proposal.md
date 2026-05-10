## Why

The current `WEBHOOK_DEDUPE_TTL_MS = 60 * 60 * 1000` (1 hour) is narrower than Meta's webhook-retry window. Meta retries failed deliveries with backoff for up to 7 days; a delivery that lands more than an hour after the first sighting is currently re-dispatched to handlers.

The original design (archived `add-webhook-receiver`) chose 1 hour on the rationale that "behaviour is unrelated to the 24h window" and "downstream is typically idempotent". That trade-off held when the only dedupe consumer was the front-desk monolith, which is idempotent end-to-end. As we extract the SDK for use by less-disciplined downstreams (clones, third parties), the safer default is to absorb more of Meta's retry burst client-side.

This change widens the default to 24 hours — long enough to absorb the bulk of Meta's retry distribution (which front-loads in the first day), short enough to keep `InMemoryStorage` memory bounded for single-instance deployments. Multi-instance deployments using a shared `Storage` (Redis, etc.) can still widen further via the `dedupeTtlMs` constructor option, which remains untouched.

## What Changes

- **MODIFIED** `src/types/constants.ts:9`: `WEBHOOK_DEDUPE_TTL_MS = 60 * 60 * 1000` → `24 * 60 * 60 * 1000`.
- **MODIFIED** `openspec/specs/webhook-receiver/spec.md`: the "Webhook dedupe by wamid" requirement updates "The default TTL SHALL be 1 hour" → "24 hours".

## Capabilities

### Modified Capabilities

- `webhook-receiver`: the default dedupe TTL widens. Consumer-supplied overrides via `WebhookReceiverOptions.dedupeTtlMs` and `WebhookDeduper(storage, ttlMs)` are unchanged.

## Non-goals

- **No widening to Meta's full 7-day retry window.** A 7-day in-process map pins memory in single-instance deployments. Consumers who need it can pass `dedupeTtlMs: 7 * 24 * 60 * 60 * 1000` plus a Redis-backed `Storage`.
- **No tying to `WINDOW_TTL_MS`.** The two constants stay separate even though the values now coincide. `WINDOW_TTL_MS` describes Meta's customer-service-window rule; `WEBHOOK_DEDUPE_TTL_MS` describes how long this SDK remembers webhook events. Treating them as one couples unrelated concerns and would force a change to one to track Meta's other.

## Impact

- **Code:** one constant change.
- **Tests:** `WebhookDeduper`'s behavioural tests use explicit TTLs and don't assert the default. No test changes required.
- **Specs:** one literal update in `webhook-receiver/spec.md`.
- **Risk:** low. Widening TTL strictly reduces duplicate dispatches; the only failure mode is more memory in single-instance `InMemoryStorage` deployments. At a typical front-desk volume (≤ 1k events/day), 24h of dedupe entries is well under 1 MB.
