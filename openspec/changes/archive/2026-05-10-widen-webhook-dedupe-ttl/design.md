## Approach

Widen the default `WEBHOOK_DEDUPE_TTL_MS` from 1 hour to 24 hours. Single-line constant change. The constructor option `dedupeTtlMs` remains the per-instance override.

## Domain rules satisfied

From `openspec/config.yaml`:

- "Meta retries failed webhook deliveries with backoff for up to 7 days; receiver is the source of truth — dedupe by `wamid`." — the SDK still dedupes by `wamid`; the change only widens the default window over which dedupe is effective. Multi-instance / Redis deployments retain full per-deployment control.

## Alternatives considered

- **Match Meta's 7-day retry window.** Rejected. 7 days of in-process state pins memory linearly with event volume; consumers running with the default `InMemoryStorage` would see surprising RSS growth. Consumers needing 7-day dedupe should run a shared store and pass an explicit `dedupeTtlMs`.
- **Tie to `WINDOW_TTL_MS`.** Rejected. The two constants describe unrelated concerns (Meta's customer-service window vs this SDK's dedupe memory). Coupling them means changing one forces a change to the other; the values coinciding now is incidental.
- **Keep at 1 hour, document the trade-off more loudly.** Rejected after review. The original rationale (idempotent downstream) holds for the front-desk monolith but does not generalise to third-party consumers of this SDK.

## Memory back-of-envelope

A `WebhookDeduper` entry in `InMemoryStorage` is roughly:

- key: `msg:wamid.<~40 chars>` ≈ 50 bytes
- value: `true` (boolean) ≈ 1 byte
- map entry overhead: ~50 bytes per entry on V8

Call it ≤ 150 bytes/entry. At 1 000 inbound events/day, 24h of state ≈ 150 kB. At 10 000 events/day (mid-volume tenant), ≈ 1.5 MB. Single-process applications can absorb this without tuning; multi-process applications should already be using a shared `Storage` for cross-instance correctness, so per-instance memory is irrelevant.
