import { describe, expect, it } from "vitest";

import { createRedisStorage, type RedisLike } from "../../../src/storage/redis.js";

import { storageContractTests } from "./contract.js";

/**
 * Minimal in-memory Redis fake that mirrors the subset of `SET`
 * semantics the adapter uses: `PX` (millisecond TTL), `NX` (only
 * if absent), TTL-aware expiry on `GET`.
 */
class FakeRedis implements RedisLike {
  readonly #map = new Map<string, { value: string; expiresAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number) {
    this.#now = now;
  }

  get(key: string): Promise<string | null> {
    const entry = this.#map.get(key);
    if (entry === undefined) return Promise.resolve(null);
    if (this.#now() >= entry.expiresAt) {
      this.#map.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null> {
    let ttlMs = Number.POSITIVE_INFINITY;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "PX") {
        ttlMs = Number(args[++i]);
      } else if (a === "NX") {
        nx = true;
      }
    }
    if (nx) {
      const existing = this.#map.get(key);
      if (existing !== undefined && this.#now() < existing.expiresAt) {
        return Promise.resolve(null);
      }
    }
    const expiresAt = ttlMs === Number.POSITIVE_INFINITY ? ttlMs : this.#now() + ttlMs;
    this.#map.set(key, { value, expiresAt });
    return Promise.resolve("OK");
  }

  del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.#map.delete(key)) count++;
    }
    return Promise.resolve(count);
  }
}

storageContractTests("RedisStorage", ({ now }) => createRedisStorage(new FakeRedis(now)));

describe("RedisStorage adapter behaviour", () => {
  it("prepends the default keyPrefix on every operation", async () => {
    const fake = new FakeRedis(() => 0);
    const storage = createRedisStorage(fake);
    await storage.set("k", "v", 60_000);
    // Default prefix is "whatsapp:" — verify by going under the
    // adapter and reading the prefixed key from the fake directly.
    expect(await fake.get("whatsapp:k")).toBe('"v"');
    expect(await fake.get("k")).toBeNull();
  });

  it("honours a custom keyPrefix", async () => {
    const fake = new FakeRedis(() => 0);
    const storage = createRedisStorage(fake, { keyPrefix: "tenant1:" });
    await storage.set("k", "v", 60_000);
    expect(await fake.get("tenant1:k")).toBe('"v"');
  });

  it("returns undefined when client.get yields null", async () => {
    const fake = new FakeRedis(() => 0);
    const storage = createRedisStorage(fake);
    expect(await storage.get<string>("missing")).toBeUndefined();
  });

  it("JSON encodes complex values and decodes on read", async () => {
    const fake = new FakeRedis(() => 0);
    const storage = createRedisStorage(fake);
    const value = { a: 1, nested: { b: [2, 3] }, flag: true };
    await storage.set("k", value, 60_000);
    expect(await storage.get<typeof value>("k")).toEqual(value);
  });
});
