import { describe, expect, it } from "vitest";

import { TokenBucket } from "../../../src/queue/token-bucket.js";

describe("TokenBucket", () => {
  it("starts at full capacity", () => {
    const b = new TokenBucket({ capacity: 5, refillPerMs: 0.001 });
    expect(b.peek()).toBe(5);
  });

  it("acquire(1) resolves immediately when tokens are available", async () => {
    const b = new TokenBucket({ capacity: 5, refillPerMs: 0.001 });
    const start = performance.now();
    await b.acquire(1);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(20);
    expect(b.peek()).toBeGreaterThan(3.9);
    expect(b.peek()).toBeLessThan(4.1);
  });

  it("acquire(1) waits when bucket is empty and resolves after refill", async () => {
    // refillPerMs = 0.01 → one token per 100 ms
    const b = new TokenBucket({ capacity: 1, refillPerMs: 0.01 });
    await b.acquire(1); // drain
    expect(b.peek()).toBeLessThan(0.1);
    const start = performance.now();
    await b.acquire(1);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThan(80);
    expect(elapsed).toBeLessThan(250);
  });

  it("refill math: tokens grow linearly with elapsed time, clamped at capacity", async () => {
    let t = 0;
    const b = new TokenBucket({ capacity: 5, refillPerMs: 1 / 1000, now: () => t });
    await b.acquire(5); // drain
    expect(b.peek()).toBe(0);
    t = 1000;
    expect(b.peek()).toBeCloseTo(1, 5);
    t = 6000;
    expect(b.peek()).toBe(5); // clamped
  });

  it("rejects acquire(count > capacity)", async () => {
    const b = new TokenBucket({ capacity: 3, refillPerMs: 0.001 });
    await expect(b.acquire(4)).rejects.toThrow(RangeError);
  });

  it("serialises concurrent acquires on an empty bucket — order preserved", async () => {
    // refillPerMs = 0.1 → one token per 10 ms
    const b = new TokenBucket({ capacity: 1, refillPerMs: 0.1 });
    await b.acquire(1); // drain
    const resolved: number[] = [];
    const a = b.acquire(1).then(() => resolved.push(1));
    const c = b.acquire(1).then(() => resolved.push(2));
    const d = b.acquire(1).then(() => resolved.push(3));
    await Promise.all([a, c, d]);
    expect(resolved).toEqual([1, 2, 3]);
  });

  it("rejects invalid constructor args", () => {
    expect(() => new TokenBucket({ capacity: 0, refillPerMs: 1 })).toThrow(RangeError);
    expect(() => new TokenBucket({ capacity: 1, refillPerMs: 0 })).toThrow(RangeError);
    expect(() => new TokenBucket({ capacity: NaN, refillPerMs: 1 })).toThrow(RangeError);
  });
});
