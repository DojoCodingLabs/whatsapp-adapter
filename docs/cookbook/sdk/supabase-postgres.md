# Cookbook — Supabase Postgres backend

Running the SDK's `PostgresStorage` (window tracker, dedupe,
custom registries) against Supabase Postgres on Vercel. The
non-obvious bits are the pgbouncer pooler quirks and the
schema setup that survives Supabase migrations.

If you're starting fresh and don't need Supabase specifically,
the generic
[`docs/sdk/storage.md`](../../sdk/storage.md) walkthrough covers
the basics. This recipe adds the Supabase-specific caveats.

## Connection-string variants

Supabase exposes **three** endpoints; pick correctly:

| Endpoint                                                       | Use                                             | Port | Pool mode        |
| -------------------------------------------------------------- | ----------------------------------------------- | ---- | ---------------- |
| Direct connection (`db.<ref>.supabase.co:5432`)                | Migrations, long-running jobs                   | 5432 | n/a              |
| Transaction pooler (`aws-0-<region>.pooler.supabase.com:6543`) | Vercel serverless, Workers, short-lived queries | 6543 | Transaction-mode |
| Session pooler (`aws-0-<region>.pooler.supabase.com:5432`)     | Long-lived connections needing session features | 5432 | Session-mode     |

For Vercel serverless + the SDK's storage adapters, **use the
transaction pooler at port 6543**. Each function invocation
gets a fresh pooled connection; transactions complete within
one query; no prepared-statement cache to worry about.

```env
# .env.local + Vercel project env
POSTGRES_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

## Why pgbouncer transaction mode matters

Supabase's transaction-mode pooler:

- Wraps every transaction in a fresh connection from the pool
  on `BEGIN`, releases on `COMMIT` / `ROLLBACK`.
- **Does not support session-level features** — `LISTEN /
NOTIFY`, `SET LOCAL` across statements, `PREPARE` /
  `EXECUTE` for cached statements, advisory locks held
  across statements.
- **Does not preserve prepared-statement state** across
  transactions.

The SDK's `PostgresStorage` uses **parameterised queries
only** (`pool.query(sql, [params])`) — these work cleanly in
transaction mode. The SDK never:

- Calls `PREPARE` / `EXECUTE`.
- Uses session-scoped settings.
- Holds advisory locks across statements.

So the SDK's storage adapter is pgbouncer-safe. The caveats
below are about _your other code_ that shares the pool.

## node-postgres pool configuration

```ts
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL!,
  // Vercel serverless: cap concurrent connections per function
  // instance LOW. The pooler multiplexes onto its own larger
  // pool; we don't need many client-side sockets.
  max: 5,
  // Aggressive idle timeout to release pooler slots quickly.
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  // CRITICAL for pgbouncer transaction mode: tell node-postgres
  // NOT to use the prepared-statement cache. Prepared statements
  // wouldn't be reusable across transactions anyway in pgbouncer
  // transaction mode, but pg's default tries — leading to
  // "prepared statement xN already exists" errors.
  statement_timeout: 30_000,
});
```

Note: `pg` doesn't expose a `statement_cache: false` flag.
The fix is to simply use parameterised queries (which `pg`
implements with the simple Query protocol, not Parse/Bind/Execute,
when the consumer doesn't explicitly use prepared statements).
All SDK adapter code does this; verify your own queries do too.

If you see `prepared statement "..." already exists` errors,
something in your codebase is using `pg-prepared-statements`
or calling `client.query({ name: ..., text: ... })`. Drop the
`name` field — that's what triggers the prepared-statement
path.

## Schema bootstrap

```sql
-- migrations/001_whatsapp_kv.sql
CREATE SCHEMA IF NOT EXISTS whatsapp;

CREATE TABLE whatsapp.kv (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX whatsapp_kv_expires_at_idx ON whatsapp.kv (expires_at);
```

Run via Supabase's SQL Editor in the dashboard or with
`supabase db push` against a migrations folder.

## Wiring up

```ts
// lib/storage.ts
import { PostgresStorage } from "@dojocoding/whatsapp-sdk/storage/postgres";
import { Pool } from "pg";

let cachedPool: Pool | undefined;
let cachedStorage: PostgresStorage | undefined;

export function getStorage(): PostgresStorage {
  if (cachedStorage) return cachedStorage;
  if (!cachedPool) {
    cachedPool = new Pool({
      connectionString: process.env.POSTGRES_URL!,
      max: 5,
      idleTimeoutMillis: 10_000,
    });
  }
  cachedStorage = new PostgresStorage({
    pool: cachedPool,
    schema: "whatsapp",
  });
  return cachedStorage;
}
```

The pool is module-scope cached — Vercel warm-invocations
reuse it. Cold starts allocate one fresh pool per function
instance.

## Per-row TTL with `expires_at`

The SDK's KV schema uses an `expires_at` column rather than
Postgres `pg_cron`-driven cleanup. The adapter's `get`
includes `WHERE expires_at > now()` so expired rows behave as
if absent.

For garbage collection (preventing table bloat), schedule a
nightly cleanup via Supabase's pg_cron:

```sql
-- Run nightly at 03:00 UTC.
SELECT cron.schedule(
  'whatsapp-kv-gc',
  '0 3 * * *',
  $$DELETE FROM whatsapp.kv WHERE expires_at < now() - interval '7 days'$$
);
```

The 7-day buffer is conservative — gives you a window to
diagnose any TTL bugs before rows actually disappear. Tune
to your retention policy.

## Window tracker against the shared storage

```ts
import { WindowTracker } from "@dojocoding/whatsapp-sdk";

import { getStorage } from "./storage";

const tracker = new WindowTracker({
  storage: getStorage(),
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
});
```

Both your webhook handler (`receiver.on("message", e => tracker.notifyInbound(e.from))`)
and your outbound client (`new WhatsAppClient({ ..., windowTracker: tracker })`)
share this — one source of truth per process. Across Vercel
function instances, the Postgres rows ARE the source of
truth; the in-memory tracker objects are just per-instance
cache pointers.

## Webhook dedupe in the same KV

```ts
import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  storage: getStorage(), // shared with the window tracker
});
```

Dedupe rows key by `wamid`; window-tracker rows key by
`window:{phone}`. Both live in the same `whatsapp.kv` table
— no schema collision because the keys are namespaced.

## OptInRegistry — separate schema recommended

The opt-in registry uses two tables (`opt_outs` + `opt_ins`)
that don't fit the KV shape. Use a dedicated schema or
table — see
[`docs/cookbook/sdk/opt-in-postgres.md`](./opt-in-postgres.md)
for the schema.

## Performance notes

- **Cold-start latency.** First Vercel invocation per function
  instance pays one pgbouncer connection setup (~50-100 ms).
  Subsequent invocations on the same warm instance are
  instant.
- **Connection limits.** Supabase free tier caps at ~60 pool
  connections. Multiply your max-per-instance setting by
  expected concurrent instances (Vercel function concurrency
  × deployed regions) — should fit comfortably with `max: 5`.
- **Read-heavy workloads.** The window-tracker is read-heavy
  (every free-form send checks the window). The
  `whatsapp.kv` PRIMARY KEY index makes these reads cheap
  (~1ms warm).

## Caveats

- **Schema migrations.** Supabase's dashboard SQL editor
  doesn't run inside transactions by default — each statement
  commits. For multi-statement migrations, use `supabase db
push` against a `migrations/` directory in your repo.
- **Backup recovery.** The `expires_at` column means old
  rows linger past their TTL until the gc cron runs. If you
  restore a backup older than ~24 hours, the window-tracker
  might emit false-open signals (think a window is open when
  the customer's actual 24h window has already lapsed). Mitigate
  by manually `DELETE FROM whatsapp.kv WHERE key LIKE 'window:%'`
  after a restore to force a cold-start state.

## See also

- [`docs/sdk/storage.md`](../../sdk/storage.md) — the
  `Storage` interface + adapter contracts.
- [`docs/cookbook/integrations/next-app-router-supabase.md`](../integrations/next-app-router-supabase.md)
  — full Site2Print-shape recipe wiring this storage into a
  Next.js App Router app.
- [`docs/cookbook/sdk/opt-in-postgres.md`](./opt-in-postgres.md)
  — same Postgres backend, different schema, for consent
  state.
