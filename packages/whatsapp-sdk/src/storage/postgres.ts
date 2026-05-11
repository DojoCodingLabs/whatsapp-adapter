import type { Storage } from "./index.js";

/**
 * Minimal structural interface of a `pg`-shaped client. Anything
 * that provides `query<R>(sql, params?): Promise<{ rows: R[] }>`
 * works — production `pg.Pool`, `pg.Client`, or a test fake. The
 * SDK does NOT import `pg` at runtime.
 */
export interface PgLike {
  query<R = unknown>(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rows: R[] }>;
}

export interface PostgresStorageOptions {
  /** Prepended to every key. Defaults to `"whatsapp:"`. */
  keyPrefix?: string;
  /** Table name. Defaults to `"whatsapp_storage"`. */
  table?: string;
}

/**
 * DDL for the storage table. Consumers MUST run this once (via
 * their own migration tool) before using `createPostgresStorage`.
 * Idempotent; safe to run repeatedly.
 *
 * The default table name is `whatsapp_storage`. If you override
 * the `table` option, edit this SQL accordingly.
 */
export const POSTGRES_STORAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS whatsapp_storage (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_storage_expires_at_idx
  ON whatsapp_storage (expires_at);
`.trim();

const INFINITY_TS = "infinity";

/**
 * Create a {@link Storage} backed by a `PgLike` client. The
 * caller owns the connection (pool, TLS, retries). Expired rows
 * are filtered on `get` (`WHERE expires_at > now()`) but not
 * proactively deleted — schedule a `DELETE FROM <table> WHERE
 * expires_at < now()` job if table growth becomes a concern.
 */
export function createPostgresStorage(
  client: PgLike,
  options: PostgresStorageOptions = {}
): Storage {
  const prefix = options.keyPrefix ?? "whatsapp:";
  const table = options.table ?? "whatsapp_storage";
  // Quote and validate the table name to a sane allow-list to
  // avoid SQL injection via dynamic table names.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new TypeError(
      `PostgresStorage: table name must be alphanumeric+underscore; got ${JSON.stringify(table)}.`
    );
  }
  const k = (key: string): string => prefix + key;

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const result = await client.query<{ value: unknown }>(
        `SELECT value FROM ${table} WHERE key = $1 AND expires_at > now()`,
        [k(key)]
      );
      if (result.rows.length === 0) return undefined;
      return result.rows[0]!.value as T;
    },

    async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
      const expiresExpr =
        ttlMs > 0 ? `now() + ($3 || ' milliseconds')::interval` : `'${INFINITY_TS}'::timestamptz`;
      const params: unknown[] = [k(key), JSON.stringify(value)];
      if (ttlMs > 0) params.push(String(ttlMs));
      await client.query(
        `INSERT INTO ${table} (key, value, expires_at)
         VALUES ($1, $2::jsonb, ${expiresExpr})
         ON CONFLICT (key) DO UPDATE
           SET value = excluded.value, expires_at = excluded.expires_at`,
        params
      );
    },

    async setIfAbsent<T>(key: string, value: T, ttlMs: number): Promise<boolean> {
      const expiresExpr =
        ttlMs > 0 ? `now() + ($3 || ' milliseconds')::interval` : `'${INFINITY_TS}'::timestamptz`;
      const params: unknown[] = [k(key), JSON.stringify(value)];
      if (ttlMs > 0) params.push(String(ttlMs));
      const result = await client.query<{ key: string }>(
        `INSERT INTO ${table} (key, value, expires_at)
         VALUES ($1, $2::jsonb, ${expiresExpr})
         ON CONFLICT (key) DO UPDATE
           SET value = excluded.value, expires_at = excluded.expires_at
           WHERE ${table}.expires_at <= now()
         RETURNING key`,
        params
      );
      return result.rows.length > 0;
    },

    async delete(key: string): Promise<void> {
      await client.query(`DELETE FROM ${table} WHERE key = $1`, [k(key)]);
    },
  };
}
