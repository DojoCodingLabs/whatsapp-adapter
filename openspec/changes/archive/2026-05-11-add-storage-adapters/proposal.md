## Why

The `Storage` interface today has one implementation: `InMemoryStorage`.
Single-process deployments work fine, but anything multi-process —
two Node workers behind a load balancer, a queue worker reading
inbound while the API server reads outbound, a multi-region
fail-over — needs a shared storage backend for the
window-tracker's 24-hour state and the webhook-deduper's wamid
set. Without that, the two processes have independent maps and
the de-dupe contract is silently broken: Meta retries a webhook,
worker A acks it, worker B treats it as fresh and double-dispatches.

The `Storage` interface is already plug-shaped — `get`, `set`,
`setIfAbsent`, `delete` with TTL semantics. This change adds two
adapters at subpath exports that implement that interface
against the two backends most production deployments already
have running: **Redis** and **Postgres**.

The adapters are intentionally thin. Redis already has the right
shape (TTL on `SET`, `SET NX` for atomicity); the adapter is mostly
JSON encode/decode + key namespacing. Postgres needs a single
`storage` table with `(key, value, expires_at)` columns and a
schema migration consumers run themselves.

## What Changes

- **NEW** `@dojocoding/whatsapp/storage/redis` subpath:
  `createRedisStorage(client, options?)` returns a `Storage` backed
  by a passed-in `ioredis`-compatible client.
- **NEW** `@dojocoding/whatsapp/storage/postgres` subpath:
  `createPostgresStorage(client, options?)` returns a `Storage`
  backed by a passed-in `pg`-compatible client.
- **NEW** `src/storage/redis.ts`, `src/storage/postgres.ts`. Both
  use minimal structural interfaces so the SDK doesn't import
  `ioredis` or `pg` at module-load time.
- **NEW** optional peer dependencies: `ioredis ^5.0.0`,
  `pg ^8.0.0`. Marked `optional` in `peerDependenciesMeta`.
- **NEW** unit tests using fake clients that implement the minimal
  structural interfaces.
- **NEW** a shared `Storage` contract test that every implementation
  runs against (`test/unit/storage/contract.ts`). The existing
  `InMemoryStorage` test is refactored to use it; the new adapters
  use the same contract suite via a fake client.
- **NEW** schema migration shipped as `src/storage/postgres.sql`
  and re-exported as a string from the postgres adapter module.
- **NEW** `docs/storage.md` documenting wiring for `WindowTracker`,
  `WebhookReceiver`, and the `outbound-queue` `BucketMap` (the
  in-process bucket map stays in-memory; this is about the
  receiver / window state).
- **MODIFIED** `tsup.config.ts` entry map: adds two new entries.
- **MODIFIED** `package.json` `exports` map: adds two new subpath
  exports.
- **MODIFIED** `.github/workflows/ci.yml` pack-contents check:
  asserts the new adapter dist artefacts.
- **MODIFIED** `docs/architecture.md` capability table: adds the
  two adapter rows under the existing `Storage` mention.
- **MODIFIED** `CHANGELOG.md` `[Unreleased]`.

## Capabilities

### Modified Capabilities

- `webhook-receiver`: spec scenarios reference the `Storage`
  interface; one new scenario asserts that swapping
  `InMemoryStorage` for `RedisStorage` or `PostgresStorage`
  produces the same dedupe behaviour.
- `window-tracker`: same shape — one new scenario about backend
  interchangeability.

### New Capabilities

None — adapters are implementations of the existing `Storage`
interface, not a new capability.

## Non-goals

- **DynamoDB / Cloudflare KV / Vercel KV adapters.** Cookbooks
  later; the two most common backends first.
- **Connection management.** Adapters take a pre-constructed
  client. Pooling, retries, TLS, auth — all upstream concerns the
  consumer already handles. The adapter just issues commands.
- **Migrations runner.** Postgres migration ships as a SQL string;
  consumers run it via whatever migration tool they already use
  (Flyway, Sqitch, Prisma migrate, plain `psql`).
- **Cluster sharding for Redis.** ioredis-cluster works
  transparently if the consumer constructs one and passes it in.
  We don't need to special-case sharded keys.
- **Streaming or pub-sub use cases.** Adapters implement the
  `Storage` interface only; no streaming primitives.

## Impact

- Public API: pure addition. Existing `InMemoryStorage` consumers
  unchanged.
- Bundle size: each adapter is ~1–2 KB CJS. Lives in its own
  subpath; root entry unaffected.
- Install footprint: `ioredis` and `pg` are optional peers. Users
  who don't import the adapters don't pull them in.
- Runtime overhead: one network round-trip per `get` / `set` /
  `delete`. The dedupe / window-tracker call sites already
  `await` the storage; no architectural change.
