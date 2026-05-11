import type { Storage } from "./index.js";

/**
 * Minimal structural interface of an `ioredis`-shaped client.
 * Anything that provides these three methods works — production
 * `ioredis`, the `node-redis` v4 legacy mode, or a test fake. The
 * SDK does NOT import `ioredis` at runtime.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  /**
   * `ioredis`'s variadic `SET`. Accepts the value followed by an
   * arbitrary list of `["PX", ttlMs, "NX"]` etc. Returns `"OK"`
   * on success, `null` when `NX` rejected.
   */
  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
}

export interface RedisStorageOptions {
  /**
   * Prepended to every key. Lets multiple consumers share one
   * Redis instance. Defaults to `"whatsapp:"`.
   */
  keyPrefix?: string;
}

/**
 * Create a {@link Storage} backed by a `RedisLike` client. The
 * client is owned by the consumer (connection pooling, TLS, auth,
 * retries are upstream concerns).
 *
 * Values are JSON-encoded; TTL is enforced by Redis itself via
 * the `PX` argument on `SET`. `ttlMs <= 0` stores forever (no
 * `PX` argument). `setIfAbsent` uses `SET NX` and is atomic by
 * Redis semantics.
 */
export function createRedisStorage(client: RedisLike, options: RedisStorageOptions = {}): Storage {
  const prefix = options.keyPrefix ?? "whatsapp:";
  const k = (key: string): string => prefix + key;

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const raw = await client.get(k(key));
      if (raw === null) return undefined;
      return JSON.parse(raw) as T;
    },

    async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
      const serialized = JSON.stringify(value);
      if (ttlMs > 0) {
        await client.set(k(key), serialized, "PX", ttlMs);
      } else {
        await client.set(k(key), serialized);
      }
    },

    async setIfAbsent<T>(key: string, value: T, ttlMs: number): Promise<boolean> {
      const serialized = JSON.stringify(value);
      const result =
        ttlMs > 0
          ? await client.set(k(key), serialized, "PX", ttlMs, "NX")
          : await client.set(k(key), serialized, "NX");
      return result === "OK";
    },

    async delete(key: string): Promise<void> {
      await client.del(k(key));
    },
  };
}
