## 1. Shared contract suite

- [x] 1.1 Create `test/unit/storage/contract.ts` exporting `storageContractTests(name: string, factory: (now?: () => number) => Storage)`. Wrap every existing scenario in `in-memory-storage.test.ts` into the suite (get/set/delete round-trip, TTL expiry, `ttlMs <= 0`, overwrite, setIfAbsent live / expired / fresh, delete idempotency).
- [x] 1.2 Refactor `test/unit/storage/in-memory-storage.test.ts` to call `storageContractTests("InMemoryStorage", ...)`. All existing tests must still pass.

## 2. Redis adapter

- [x] 2.1 Define `interface RedisLike` in `src/storage/redis.ts` covering only `get`, `set` (with variadic args), and `del`. No `import "ioredis"`.
- [x] 2.2 Implement `createRedisStorage(client, options?)` returning a `Storage`. Defaults: `keyPrefix = "whatsapp:"`. JSON-encode values; treat `null` returns from `client.get` as `undefined`.
- [x] 2.3 `set(k, v, ttlMs)`:
  - if `ttlMs > 0`: `client.set(prefix + k, JSON.stringify(v), "PX", ttlMs)`
  - else: `client.set(prefix + k, JSON.stringify(v))`
- [x] 2.4 `setIfAbsent(k, v, ttlMs)`: same as `set` but append `"NX"`. Return `true` iff the result is `"OK"`.
- [x] 2.5 `delete(k)`: `client.del(prefix + k)`. Idempotent.
- [x] 2.6 Add `ioredis ^5.0.0` to `peerDependencies` with `peerDependenciesMeta.ioredis.optional = true`. Add `"ioredis"` to tsup `external`.

## 3. Postgres adapter

- [x] 3.1 Define `interface PgLike` in `src/storage/postgres.ts` covering `query<R>(sql, params?): Promise<{ rows: R[] }>`. No `import "pg"`.
- [x] 3.2 Implement `createPostgresStorage(client, options?)`. Defaults: `keyPrefix = "whatsapp:"`, `table = "whatsapp_storage"`. JSON-encode values via `JSON.stringify` (passed as a single parameter; pg serializes it to JSONB).
- [x] 3.3 `get(k)`: `SELECT value FROM ${table} WHERE key = $1 AND expires_at > now()`. Return `rows[0]?.value`. Expired rows fall through to `undefined` without deletion (lazy eviction).
- [x] 3.4 `set(k, v, ttlMs)`: `INSERT ... ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`. TTL `<= 0` → `expires_at = 'infinity'::timestamptz`.
- [x] 3.5 `setIfAbsent(k, v, ttlMs)`: `INSERT ... ON CONFLICT (key) DO UPDATE ... WHERE ${table}.expires_at <= now() RETURNING key`. If `rows.length === 0`, the existing entry was still live → return `false`.
- [x] 3.6 `delete(k)`: `DELETE FROM ${table} WHERE key = $1`.
- [x] 3.7 Export `POSTGRES_STORAGE_SCHEMA: string` containing the `CREATE TABLE` + index SQL.
- [x] 3.8 Add `pg ^8.0.0` to `peerDependencies` with `peerDependenciesMeta.pg.optional = true`. Add `"pg"` to tsup `external`.

## 4. Tests

- [x] 4.1 Implement an in-memory `RedisLike` fake in `test/unit/storage/redis.test.ts` (Map of key → { value, expiresAt }; mirrors Redis semantics including `NX`).
- [x] 4.2 Run `storageContractTests("RedisStorage", ...)` against the adapter wrapping the fake.
- [x] 4.3 Implement an in-memory `PgLike` fake in `test/unit/storage/postgres.test.ts` that interprets the adapter's SQL by pattern (small switch on the SQL text — sufficient because the adapter only issues 5 distinct statements).
- [x] 4.4 Run `storageContractTests("PostgresStorage", ...)` against the adapter wrapping the fake.
- [x] 4.5 Adapter-specific tests:
  - Redis: `keyPrefix` is prepended; returns `undefined` when `client.get` returns `null`; JSON encoding round-trips.
  - Postgres: schema string is non-empty and contains the CREATE TABLE; `keyPrefix` is prepended; `expires_at <= now()` filter is respected (write expired row, `get` returns `undefined`).

## 5. Build & exports

- [x] 5.1 Add two new entries to `tsup.config.ts`: `"storage/redis/index": "src/storage/redis.ts"` and `"storage/postgres/index": "src/storage/postgres.ts"` (or single-file entries — the storage module isn't a directory). Adjust the path if needed so the dist artefacts live at `dist/storage/redis.{js,cjs,d.ts}` and `dist/storage/postgres.{js,cjs,d.ts}`.
- [x] 5.2 Add `./storage/redis` and `./storage/postgres` to `package.json` `exports`, mirroring the `./express` / `./hono` shape.
- [x] 5.3 Verify built artefacts: each adapter CJS bundle under 5 KB; no `ioredis` or `pg` internals inlined; `require("ioredis")` / `require("pg")` references absent because both are type-only imports (same pattern as Hono).
- [x] 5.4 Extend the CI pack-contents check to require the new adapter dist files.

## 6. Documentation

- [x] 6.1 Add `docs/storage.md` covering the `Storage` interface, when to use each backend (single-process vs multi-process), wiring examples for `WindowTracker` and `WebhookReceiver`, and the Postgres migration step.
- [x] 6.2 Update `docs/architecture.md` capability table with the two storage rows.
- [x] 6.3 Update `docs/compliance.md` § "What you must enforce" to mention "use a shared storage backend in multi-process deployments".
- [x] 6.4 Update `CHANGELOG.md` `[Unreleased]` with the new subpaths and peer deps.

## 7. Archive

- [x] 7.1 `openspec validate --changes --strict` — clean.
- [x] 7.2 Push, wait for CI green (release-discipline skill).
- [x] 7.3 Tick all task checkboxes; commit.
- [x] 7.4 `openspec archive add-storage-adapters --yes`.
- [x] 7.5 Commit the archive + spec deltas merge.
