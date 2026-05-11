# Storage adapters

The SDK uses a small `Storage` interface for two pieces of state:

- **`WindowTracker`** — the 24-hour customer-service window per
  recipient. See [`docs/window.md`](./window.md).
- **`WebhookDeduper`** (inside `WebhookReceiver`) — the dedupe set
  keyed by `wamid` covering Meta's up-to-7-day delivery retries.
  See [`docs/webhooks.md`](./webhooks.md).

Three implementations ship out of the box. Use the one that
matches your deployment shape.

| Backend                 | Use it when                                            | Subpath                                     |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `InMemoryStorage`       | Single Node process, dev, tests                        | root: `@dojocoding/whatsapp-sdk`            |
| `createRedisStorage`    | Multi-process / multi-worker, Redis already present    | `@dojocoding/whatsapp-sdk/storage/redis`    |
| `createPostgresStorage` | Multi-process / multi-worker, Postgres already present | `@dojocoding/whatsapp-sdk/storage/postgres` |

> **`InMemoryStorage` is NOT safe for multi-process deployments.**
> Two workers each have their own map — Meta retries a webhook,
> worker A acks it, worker B treats it as fresh and double-dispatches.
> Use a shared backend (Redis or Postgres) when more than one Node
> process touches the same WABA.

## The `Storage` interface

```ts
interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  setIfAbsent<T>(key: string, value: T, ttlMs: number): Promise<boolean>;
  delete(key: string): Promise<void>;
}
```

- `set(k, v, ttlMs)`: write; `ttlMs <= 0` stores forever.
- `setIfAbsent(k, v, ttlMs)`: atomic write iff no live entry
  exists. Returns `true` on insert, `false` if a live entry was
  already there.
- TTL is honoured by the backend itself (Redis: native; Postgres:
  `WHERE expires_at > now()` filter).

## Redis adapter

```ts
import Redis from "ioredis";
import { WebhookReceiver, WindowTracker } from "@dojocoding/whatsapp-sdk";
import { createRedisStorage } from "@dojocoding/whatsapp-sdk/storage/redis";

const redis = new Redis(process.env.REDIS_URL!);
const storage = createRedisStorage(redis, { keyPrefix: "whatsapp:" });

const tracker = new WindowTracker({ phoneNumberId: "PNID", storage });
const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  storage,
});
```

- TTL is enforced natively by Redis (`SET PX ms`).
- `setIfAbsent` uses `SET NX` — atomic by Redis semantics.
- Connection management is yours: pool, TLS, retries, sentinel /
  cluster setup. The adapter just issues commands.

`ioredis` is an optional peer dependency on `^5.0.0`. Consumers who
don't import this subpath don't pull `ioredis` into their tree.

## Postgres adapter

```ts
import { Pool } from "pg";
import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import {
  createPostgresStorage,
  POSTGRES_STORAGE_SCHEMA,
} from "@dojocoding/whatsapp-sdk/storage/postgres";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Run once via your migration tool of choice (Flyway, Sqitch,
// Prisma migrate, plain psql). Idempotent.
await pool.query(POSTGRES_STORAGE_SCHEMA);

const storage = createPostgresStorage(pool, { keyPrefix: "whatsapp:" });

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  storage,
});
```

### Schema

```sql
CREATE TABLE IF NOT EXISTS whatsapp_storage (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_storage_expires_at_idx
  ON whatsapp_storage (expires_at);
```

### Lazy eviction

Expired rows are filtered out of `get` results via `WHERE
expires_at > now()` but NOT deleted automatically. If table growth
becomes a concern, schedule a periodic cleanup:

```sql
DELETE FROM whatsapp_storage WHERE expires_at < now();
```

Either via cron from your app or via `pg_cron`. The default index
on `expires_at` keeps the cleanup query cheap.

### Table-name override

The default table is `whatsapp_storage`. To partition by tenant or
align with your naming convention:

```ts
const storage = createPostgresStorage(pool, {
  table: "tenant1_whatsapp_storage",
  keyPrefix: "tenant1:",
});
```

Edit `POSTGRES_STORAGE_SCHEMA` accordingly before running it
(replace `whatsapp_storage` with your chosen table name).

Table name is validated against `/^[A-Za-z_][A-Za-z0-9_]*$/` to
prevent SQL injection via the dynamic identifier. Pass anything
else and the factory throws `TypeError` at construction.

## In-memory (default)

```ts
import { InMemoryStorage } from "@dojocoding/whatsapp-sdk";

const storage = new InMemoryStorage();
```

Suitable for:

- Local development.
- Unit / contract tests where determinism matters more than
  durability.
- Genuinely single-process deployments where a process restart
  losing state is acceptable.

NOT suitable for any deployment where two Node processes share
the same WABA — see the warning at the top of this page.

## Plugging your own backend

Anything implementing the `Storage` interface works. Common
candidates:

- **DynamoDB**: write a thin wrapper using `aws-sdk`'s `DocumentClient`.
- **Cloudflare KV / Workers Durable Objects**: KV's `put(key, value, { expirationTtl })` maps to `set`; `get` and `delete` are native; `setIfAbsent` requires a `getWithMetadata` + `put` dance.
- **Vercel KV** (Upstash Redis): use `createRedisStorage` with the
  Upstash REST client wrapped to the `RedisLike` interface, or with
  Upstash's own `Redis` SDK (drop-in for ioredis on the read/write
  subset).

## Cross-references

- [`docs/window.md`](./window.md) — `WindowTracker` semantics.
- [`docs/webhooks.md`](./webhooks.md) — `WebhookReceiver` dedupe.
- [`docs/compliance.md`](./compliance.md) — Meta's retry window
  (up to 7 days) which the dedupe set must cover.
