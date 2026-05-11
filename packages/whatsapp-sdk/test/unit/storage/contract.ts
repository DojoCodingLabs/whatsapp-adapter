import { describe, expect, it } from "vitest";

import type { Storage } from "../../../src/storage/index.js";

/**
 * Shared contract suite for any `Storage` implementation. Every
 * backend (`InMemoryStorage`, `createRedisStorage`,
 * `createPostgresStorage`) calls this so drift between
 * implementations is impossible-to-not-notice.
 *
 * The factory is given a `now: () => number` callback that the
 * implementation MUST use for any TTL math, AND a `tick(ms)`
 * callback the test calls to advance simulated time. The
 * implementation is responsible for wiring both into its backend
 * (the in-memory fake mirrors `now`; the test harness for
 * Redis/Postgres fakes uses `tick` to drive their TTL math).
 */
export interface StorageFactory {
  (clock: { now: () => number; tick: (ms: number) => void }): Storage;
}

export function storageContractTests(name: string, factory: StorageFactory): void {
  describe(`${name} (storage contract)`, () => {
    function build(): { storage: Storage; tick: (ms: number) => void } {
      let t = 0;
      const clock = {
        now: () => t,
        tick: (ms: number) => {
          t += ms;
        },
      };
      return { storage: factory(clock), tick: clock.tick };
    }

    it("get/set/delete round-trip", async () => {
      const { storage } = build();
      await storage.set("k", 42, 60_000);
      expect(await storage.get<number>("k")).toBe(42);
      await storage.delete("k");
      expect(await storage.get<number>("k")).toBeUndefined();
    });

    it("TTL expires lazily on get", async () => {
      const { storage, tick } = build();
      await storage.set("k", "v", 100);
      expect(await storage.get<string>("k")).toBe("v");
      tick(101);
      expect(await storage.get<string>("k")).toBeUndefined();
    });

    it("delete is idempotent on missing key", async () => {
      const { storage } = build();
      await expect(storage.delete("nonexistent")).resolves.toBeUndefined();
    });

    it("ttlMs <= 0 stores forever", async () => {
      const { storage, tick } = build();
      await storage.set("k", "forever", 0);
      tick(10 * 365 * 24 * 60 * 60 * 1000);
      expect(await storage.get<string>("k")).toBe("forever");
    });

    it("set overwrites a previous value and TTL", async () => {
      const { storage, tick } = build();
      await storage.set("k", "old", 100);
      await storage.set("k", "new", 60_000);
      tick(200);
      expect(await storage.get<string>("k")).toBe("new");
    });

    it("setIfAbsent: succeeds on a missing key", async () => {
      const { storage } = build();
      expect(await storage.setIfAbsent("k", "first", 60_000)).toBe(true);
      expect(await storage.get<string>("k")).toBe("first");
    });

    it("setIfAbsent: returns false when a live entry exists", async () => {
      const { storage } = build();
      await storage.set("k", "live", 60_000);
      expect(await storage.setIfAbsent("k", "second", 60_000)).toBe(false);
      expect(await storage.get<string>("k")).toBe("live");
    });

    it("setIfAbsent: returns true when the existing entry has expired", async () => {
      const { storage, tick } = build();
      await storage.set("k", "stale", 100);
      tick(101);
      expect(await storage.setIfAbsent("k", "fresh", 60_000)).toBe(true);
      expect(await storage.get<string>("k")).toBe("fresh");
    });

    it("round-trips JSON-shaped values (object, array, boolean, null sentinel)", async () => {
      const { storage } = build();
      await storage.set("obj", { a: 1, b: [2, 3] }, 60_000);
      expect(await storage.get<{ a: number; b: number[] }>("obj")).toEqual({ a: 1, b: [2, 3] });
      await storage.set("bool", true, 60_000);
      expect(await storage.get<boolean>("bool")).toBe(true);
    });
  });
}
