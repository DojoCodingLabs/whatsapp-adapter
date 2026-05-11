## Context

`Storage` is the dependency injection point for two SDK concerns
that need shared state across processes:

- `WindowTracker` — the 24-hour customer-service window per
  recipient. Each inbound user message resets the TTL on a key
  scoped to `${phoneNumberId}:${recipient}`.
- `WebhookDeduper` — the dedupe set keyed by `wamid`. Meta retries
  failed deliveries for up to 7 days; without shared dedupe across
  workers, the same `wamid` fires the handler N times.

In single-process deployments, `InMemoryStorage` is the right
answer. Multi-process / multi-region deployments need a backend
both processes see. Redis and Postgres cover ~95 % of production
infra.

The `Storage` interface (`get`, `set`, `setIfAbsent`, `delete`,
all async, all TTL-aware) is already plug-shaped. This change is
about wiring two concrete backends to it.

Domain rules from `openspec/config.yaml` this design must satisfy:

- **One library instance per WABA-phone pair.** Preserved — the
  adapter doesn't change how `WindowTracker` / `WebhookDeduper`
  use storage; it just changes where the bytes live.
- **TTL must be honoured.** Entries past expiry SHALL NOT return
  via `get`. Redis enforces this natively via `PX`; Postgres
  enforces it via a `WHERE expires_at > now()` filter on `get` and
  `setIfAbsent`.
- **Zero global state.** Adapters take a pre-constructed client.
  No module-level state.
- **Pluggable peer dependencies.** Both `ioredis` and `pg` are
  optional peers. The SDK doesn't import them at module load —
  the adapter modules only reference them via structural types,
  and consumers pass an already-constructed instance.

## Goals / Non-Goals

**Goals:**

- `createRedisStorage(client, options?)` and
  `createPostgresStorage(client, options?)` factories returning
  the same `Storage` interface `InMemoryStorage` satisfies.
- Behavioural parity with `InMemoryStorage` for the four
  operations. Every contract test the in-memory implementation
  passes, the Redis and Postgres implementations pass.
- Optional key prefix (`options.keyPrefix`, default `"whatsapp:"`)
  so multiple consumers can share one Redis instance / Postgres
  table without colliding.
- Postgres schema shipped as a literal SQL string; consumer runs
  it via their own migration tool.
- Test-friendly: adapters use structural interfaces, so a fake
  client in test code is sufficient. No docker required for CI.

**Non-Goals:**

- Auto-migration. Consumers run the SQL themselves.
- Connection management. Pool, TLS, retries — all upstream.
- Pub/sub or streaming primitives.
- Cluster-aware key hashing for ioredis-cluster. Users who pass
  a cluster client get cluster semantics for free.

## Decisions

### Decision: client passed in, not constructed

**Rationale.** Consumers already construct an `ioredis` or `pg`
client at app startup with their own connection pool, TLS, auth,
retry policy. Re-constructing inside the adapter would either
duplicate that config (wrong, gets out of sync) or require the
adapter to know about every config knob (huge surface). Taking
a pre-constructed client is one line in the consumer's code and
zero surface in the SDK.

**Alternative:** accept connection options + construct internally
— rejected for the reasons above.

### Decision: structural typing, not direct dependency

**Rationale.** If the adapter imports `ioredis`, the SDK pulls
`ioredis` into the bundle even when the user doesn't use the
redis subpath. By defining minimal structural interfaces like
`interface RedisLike { set(...): Promise<...>; get(...): ... }`,
the adapter accepts any client that exposes those methods —
`ioredis`, `node-redis`, a future driver, or a test fake.

**Alternative:** import the libraries directly — coupling +
bundle bloat.

### Decision: Redis adapter API surface

```ts
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

function createRedisStorage(
  client: RedisLike,
  options?: { keyPrefix?: string }
): Storage;
```

Implementation:
- `get(k)` → `client.get(prefix + k)`, JSON.parse the result,
  return `undefined` if null.
- `set(k, v, ttlMs)` → `client.set(prefix + k, JSON.stringify(v),
  "PX", ttlMs)`.
- `setIfAbsent(k, v, ttlMs)` → `client.set(prefix + k,
  JSON.stringify(v), "PX", ttlMs, "NX")`. Returns `true` if
  the result is `"OK"`, `false` if `null` (NX rejection).
- `delete(k)` → `client.del(prefix + k)`.

TTL of `<= 0` maps to "store forever" — Redis distinguishes via
`set(k, v)` with no `PX` argument.

### Decision: Postgres adapter API surface

```ts
interface PgLike {
  query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

function createPostgresStorage(
  client: PgLike,
  options?: { keyPrefix?: string; table?: string }
): Storage;

export const POSTGRES_STORAGE_SCHEMA: string; // the migration SQL
```

Schema:

```sql
CREATE TABLE IF NOT EXISTS whatsapp_storage (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_storage_expires_at_idx
  ON whatsapp_storage (expires_at);
```

Implementation:
- `get(k)` → `SELECT value FROM ${table} WHERE key = $1 AND
  expires_at > now()`. Return `rows[0]?.value`.
- `set(k, v, ttlMs)` → `INSERT ... ON CONFLICT (key) DO UPDATE`.
- `setIfAbsent(k, v, ttlMs)` → upsert with a `WHERE
  whatsapp_storage.expires_at <= now()` clause on the `DO UPDATE`,
  `RETURNING (xmax = 0)` to distinguish insert from update-of-
  expired. If 0 rows returned, the conflicting row was still live
  → `false`.
- `delete(k)` → `DELETE FROM ${table} WHERE key = $1`.
- TTL of `<= 0` maps to `expires_at = 'infinity'::timestamptz`.

The TTL filter on `get` means expired rows linger in the table
until reaped. That's intentional — lazy eviction matches the
in-memory behaviour. Consumers can schedule a `DELETE FROM
whatsapp_storage WHERE expires_at < now()` cron or pg_cron job
if table growth becomes a problem; the docs flag this.

### Decision: shared contract test

All three `Storage` implementations run against the same suite.
The existing
`test/unit/storage/in-memory-storage.test.ts` becomes a
parametrised loop over `[InMemoryStorage, RedisStorage (with fake),
PostgresStorage (with fake)]`. Drift between implementations
becomes impossible-to-not-notice.

### Decision: subpath exports, not separate packages

**Rationale.** Matches the existing `/express` and `/hono`
pattern. Single repo, single release cadence, optional peers.
Consumers only pay for what they import. (User confirmed this
choice as option A.)

**Alternative:** ship as `@dojocoding/whatsapp-storage-redis` and
`@dojocoding/whatsapp-storage-postgres` — more publishing
overhead, more version-skew failure modes.

## Control flow

```
WindowTracker.markWindowOpen(to) — already async
  │
  ▼
storage.set(`window:${pnid}:${to}`, true, WINDOW_TTL_MS)
  │
  ▼ (Redis adapter)
client.set("whatsapp:window:PNID:+52...", "true", "PX", 86_400_000)
  │
  ▼ (Postgres adapter)
INSERT INTO whatsapp_storage VALUES ($1, $2, now() + interval '1 day')
  ON CONFLICT (key) DO UPDATE SET ... ;
```

## Risks

- **JSON encode/decode overhead** for Redis. Negligible; values
  are short (booleans, strings). Documented.
- **Postgres lock contention** on a single hot key. Unlikely for
  WhatsApp use cases (the per-recipient window state isn't
  high-contention), but document the table name override so
  consumers who hit it can partition by tenant.
- **Schema drift** if the migration changes. Pre-1.0, we'll bump
  major / minor and document the migration step.
- **Optional-peer footgun.** A consumer who installs `ioredis`
  but never imports the adapter still triggers the peer check.
  Mitigation: `peerDependenciesMeta.optional = true` silences
  npm; documented.

## Test layers

- **Unit (with fakes)**:
  - `test/unit/storage/contract.ts` exports a `storageContractTests`
    function the three implementations call.
  - `test/unit/storage/in-memory-storage.test.ts` updated to use the
    shared contract suite.
  - `test/unit/storage/redis.test.ts` runs against a small in-memory
    fake of `RedisLike`.
  - `test/unit/storage/postgres.test.ts` runs against a small
    in-memory fake of `PgLike`.
- **Integration**: out of scope for this change. Real Redis /
  Postgres tests live in a follow-up that gates on a `WHATSAPP_E2E=1`
  workflow (the existing nightly hook).
