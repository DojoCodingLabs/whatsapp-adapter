import { describe, expect, it } from "vitest";

import {
  createPostgresStorage,
  type PgLike,
  POSTGRES_STORAGE_SCHEMA,
} from "../../../src/storage/postgres.js";

import { storageContractTests } from "./contract.js";

interface FakeRow {
  key: string;
  value: unknown;
  expiresAt: number;
}

/**
 * In-memory pg fake that interprets the small set of SQL
 * statements the PostgresStorage adapter issues. The adapter
 * uses exactly four statement shapes; the fake matches each by
 * substring.
 */
class FakePg implements PgLike {
  readonly #rows = new Map<string, FakeRow>();
  readonly #now: () => number;

  constructor(now: () => number) {
    this.#now = now;
  }

  query<R = unknown>(sql: string, params: ReadonlyArray<unknown> = []): Promise<{ rows: R[] }> {
    const s = sql.replace(/\s+/g, " ").trim();

    // SELECT value FROM <t> WHERE key = $1 AND expires_at > now()
    if (s.startsWith("SELECT value FROM")) {
      const key = String(params[0]);
      const row = this.#rows.get(key);
      if (row === undefined || row.expiresAt <= this.#now()) {
        return Promise.resolve({ rows: [] as R[] });
      }
      return Promise.resolve({ rows: [{ value: row.value }] as unknown as R[] });
    }

    // INSERT ... RETURNING key  (the setIfAbsent path)
    if (s.startsWith("INSERT INTO") && s.includes("RETURNING key")) {
      const key = String(params[0]);
      const value = JSON.parse(String(params[1])) as unknown;
      const expiresAt = this.#computeExpiresAt(s, params);
      const existing = this.#rows.get(key);
      if (existing !== undefined && existing.expiresAt > this.#now()) {
        // Live conflict — WHERE expires_at <= now() filters this out.
        return Promise.resolve({ rows: [] as R[] });
      }
      this.#rows.set(key, { key, value, expiresAt });
      return Promise.resolve({ rows: [{ key }] as unknown as R[] });
    }

    // INSERT ... ON CONFLICT DO UPDATE  (the set path)
    if (s.startsWith("INSERT INTO") && s.includes("ON CONFLICT")) {
      const key = String(params[0]);
      const value = JSON.parse(String(params[1])) as unknown;
      const expiresAt = this.#computeExpiresAt(s, params);
      this.#rows.set(key, { key, value, expiresAt });
      return Promise.resolve({ rows: [] as R[] });
    }

    // DELETE FROM <t> WHERE key = $1
    if (s.startsWith("DELETE FROM")) {
      const key = String(params[0]);
      this.#rows.delete(key);
      return Promise.resolve({ rows: [] as R[] });
    }

    throw new Error(`FakePg: unhandled SQL: ${s}`);
  }

  #computeExpiresAt(sql: string, params: ReadonlyArray<unknown>): number {
    if (sql.includes("'infinity'::timestamptz")) {
      return Number.POSITIVE_INFINITY;
    }
    // The TTL ms is parameter $3 stringified.
    const ttlMs = Number(params[2]);
    return this.#now() + ttlMs;
  }
}

storageContractTests("PostgresStorage", ({ now }) => createPostgresStorage(new FakePg(now)));

describe("PostgresStorage adapter behaviour", () => {
  it("POSTGRES_STORAGE_SCHEMA contains CREATE TABLE and an index", () => {
    expect(POSTGRES_STORAGE_SCHEMA).toContain("CREATE TABLE IF NOT EXISTS whatsapp_storage");
    expect(POSTGRES_STORAGE_SCHEMA).toContain("CREATE INDEX IF NOT EXISTS");
    expect(POSTGRES_STORAGE_SCHEMA).toContain("expires_at");
  });

  it("prepends the default keyPrefix on every operation", async () => {
    const t = 0;
    const fake = new FakePg(() => t);
    const storage = createPostgresStorage(fake);
    await storage.set("k", "v", 60_000);
    // Inspect via a direct adapter call against the same fake.
    const result = await fake.query<{ value: unknown }>(
      "SELECT value FROM whatsapp_storage WHERE key = $1 AND expires_at > now()",
      ["whatsapp:k"]
    );
    expect(result.rows[0]?.value).toBe("v");
  });

  it("honours custom keyPrefix and table", async () => {
    const t = 0;
    const fake = new FakePg(() => t);
    const storage = createPostgresStorage(fake, {
      keyPrefix: "tenant1:",
      table: "custom_table",
    });
    await storage.set("k", "v", 60_000);
    const result = await fake.query<{ value: unknown }>(
      "SELECT value FROM custom_table WHERE key = $1 AND expires_at > now()",
      ["tenant1:k"]
    );
    expect(result.rows[0]?.value).toBe("v");
  });

  it("rejects invalid table names", () => {
    const fake = new FakePg(() => 0);
    expect(() => createPostgresStorage(fake, { table: "drop; -- bad" })).toThrow(TypeError);
  });

  it("expired rows fall through to undefined (lazy eviction; row may remain)", async () => {
    let t = 0;
    const fake = new FakePg(() => t);
    const storage = createPostgresStorage(fake);
    await storage.set("k", "v", 100);
    t = 101;
    expect(await storage.get<string>("k")).toBeUndefined();
  });
});
