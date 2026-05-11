## ADDED Requirements

### Requirement: Redis and Postgres storage adapters

The package SHALL export `createRedisStorage(client, options?)` from `@dojocoding/whatsapp/storage/redis` and `createPostgresStorage(client, options?)` from `@dojocoding/whatsapp/storage/postgres`. Both factories SHALL return objects that implement the `Storage` interface (`get`, `set`, `setIfAbsent`, `delete`) with TTL semantics equivalent to `InMemoryStorage`.

Both factories SHALL accept a pre-constructed client object. The adapters SHALL NOT import `ioredis` or `pg` directly — both are declared as optional peer dependencies and referenced via minimal structural interfaces (`RedisLike`, `PgLike`) so consumers may pass any compatible client (production drivers or test fakes).

The Postgres adapter SHALL additionally export `POSTGRES_STORAGE_SCHEMA: string` containing the `CREATE TABLE` and index DDL the consumer runs via their own migration tool.

Both adapters SHALL accept an optional `keyPrefix` (default `"whatsapp:"`) so multiple consumers may share one backend without colliding.

#### Scenario: RedisStorage round-trips a value with TTL

- **WHEN** `createRedisStorage(client).set("k", 42, 1_000)` is called against an ioredis-compatible client and the consumer then calls `get<number>("k")`
- **THEN** `get` resolves to `42`
- **AND** waiting 1_001 ms before the next `get` yields `undefined` (Redis-enforced TTL expiry)

#### Scenario: RedisStorage setIfAbsent uses SET NX

- **WHEN** the same key is set twice via `setIfAbsent`
- **THEN** the first call returns `true`
- **AND** the second call (while the first is unexpired) returns `false`
- **AND** the stored value remains the first one

#### Scenario: PostgresStorage filters expired rows on get

- **WHEN** `createPostgresStorage(client).set("k", "v", 100)` is called and the consumer waits 101 ms (or advances `now()` past the row's `expires_at`) before calling `get<string>("k")`
- **THEN** `get` resolves to `undefined`
- **AND** the row may still exist in the table (lazy eviction); a separate `DELETE WHERE expires_at < now()` job is a consumer concern

#### Scenario: PostgresStorage setIfAbsent succeeds when the existing row is expired

- **WHEN** an expired row exists for `"k"` and `setIfAbsent("k", "new", 60_000)` is called
- **THEN** the call returns `true`
- **AND** subsequent `get<string>("k")` resolves to `"new"`

#### Scenario: WebhookDeduper produces identical behaviour across storage backends

- **WHEN** the same `wamid` is processed by a `WebhookReceiver` configured with `InMemoryStorage`, `createRedisStorage(client)`, or `createPostgresStorage(client)`
- **THEN** all three configurations dedupe identically — the second processing attempt finds the existing entry and skips dispatch
- **AND** the registered handler is invoked exactly once across each backend
