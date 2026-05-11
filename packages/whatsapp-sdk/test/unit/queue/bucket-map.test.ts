import { describe, expect, it } from "vitest";

import { BucketMap } from "../../../src/queue/bucket-map.js";

describe("BucketMap", () => {
  it("creates buckets lazily and isolates keys", async () => {
    const map = new BucketMap({ capacity: 1, refillPerMs: 0.01 });
    await map.acquire("A");
    // A drained, B fresh
    const start = performance.now();
    await map.acquire("B");
    expect(performance.now() - start).toBeLessThan(20);
    expect(map.size()).toBe(2);
  });

  it("evicts stale full buckets after evictAfterMs", async () => {
    let t = 0;
    const map = new BucketMap({
      capacity: 1,
      refillPerMs: 0.001,
      evictAfterMs: 100,
      now: () => t,
    });
    await map.acquire("A");
    await map.acquire("B");
    expect(map.size()).toBe(2);
    // Refill both buckets back to capacity by advancing time.
    t = 10_000;
    // Touch some other key — eviction sweeps run on each acquire.
    await map.acquire("C");
    // A and B were full and idle for 10 s > 100 ms — evicted. C is new.
    expect(map.size()).toBe(1);
  });

  it("rejects invalid evictAfterMs", () => {
    expect(() => new BucketMap({ capacity: 1, refillPerMs: 0.001, evictAfterMs: 0 })).toThrow(
      RangeError
    );
  });
});
