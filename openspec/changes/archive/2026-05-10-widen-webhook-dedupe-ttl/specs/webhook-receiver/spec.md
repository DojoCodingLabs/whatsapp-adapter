## MODIFIED Requirements

### Requirement: Webhook dedupe by wamid

The package SHALL export a `WebhookDeduper(storage, ttlMs)` whose `markIfNew(eventKey)` returns `true` when the event was not seen within the TTL window and `false` when it was. The default TTL SHALL be 24 hours. The receiver SHALL skip dispatch for any `message` event whose `wamid` was already seen, and any `status` event whose `id` was already seen with the same `status` value.

#### Scenario: First sighting of a wamid is new

- **WHEN** `await deduper.markIfNew("wamid.abc")`
- **THEN** the return value is `true`

#### Scenario: Second sighting within TTL is duplicate

- **WHEN** the same wamid is `markIfNew`-ed twice in a row
- **THEN** the second call returns `false`

#### Scenario: Sighting after TTL expiry is treated as new again

- **WHEN** `markIfNew("wamid.abc")` is called, time advances past the TTL, and `markIfNew("wamid.abc")` is called again
- **THEN** the second call returns `true`
