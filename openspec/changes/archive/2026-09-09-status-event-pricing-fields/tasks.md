## 1. StatusEvent

- [x] 1.1 Add `pricingType`, `pricingModel`, `billable` to `StatusEvent` with JSDoc describing Meta's values and the Oct 1, 2026 relevance.
- [x] 1.2 Correct the `conversationId` / `pricingCategory` JSDoc.
- [x] 1.3 `parser.ts#parseStatus` lifts the three fields with type guards; omits when absent.

## 2. Tests

- [x] 2.1 Fixture `status-sent-pmp.json` (PMP, no `conversation`, `type: free_customer_service`).
- [x] 2.2 Parser unit tests: legacy CBP fixture still parses; PMP fixture lifts all fields; failed status omits pricing keys.

## 3. Docs (F19 / F20 / F22 / F24 / F25)

- [x] 3.1 `WhatsAppClientOptions.windowTracker` JSDoc — only templates exempt.
- [x] 3.2 `docs/sdk/webhooks.md` — pricing-fields table; dedupe-before-dispatch section; fixed stale "1h TTL" note + anchors.
- [x] 3.3 `docs/compliance.md` § 2 — items 9–11 (Oct 1 pricing, `user_preferences`, handler retries); fixed `./window.md` / `./storage.md` / `./mock.md` links.
- [x] 3.4 `ROADMAP.md` — `sdk-v0.10.0` / `mcp-v0.5.0` story; audit F25 candidates in Q4.
