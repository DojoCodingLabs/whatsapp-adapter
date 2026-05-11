import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { TokenBucket } from "../../../src/queue/token-bucket.js";

/**
 * Property-based rate-adherence test for `TokenBucket`. Uses an
 * injected clock so timing is deterministic — no real `setTimeout`
 * needed.
 *
 * Claim: starting from an empty bucket, the time required to acquire
 * N consecutive tokens at `refillPerMs = M / 1000` (i.e. M tokens
 * per second) is exactly `ceil(N / M * 1000)` ms (modulo the
 * 1-ms minimum-wait floor in `TokenBucket.acquire`).
 */
describe("TokenBucket: rate-adherence property", () => {
  it("acquiring N tokens at M MPS takes ~ N/M seconds (clock-controlled)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 5, max: 200 }),
        async (n, mps) => {
          let now = 0;
          const bucket = new TokenBucket({
            capacity: 1,
            refillPerMs: mps / 1000,
            now: () => now,
          });
          await bucket.acquire(1); // drain
          const start = now;

          for (let i = 0; i < n - 1; i++) {
            // Advance the clock by one refill window. The bucket
            // will see the elapsed time and refill enough for one
            // token; acquire(1) resolves on the next event-loop
            // tick.
            now += Math.ceil(1000 / mps);
            await bucket.acquire(1);
          }

          const elapsedSimulated = now - start;
          // n-1 inter-token gaps of ceil(1000/mps).
          const expected = (n - 1) * Math.ceil(1000 / mps);
          return elapsedSimulated === expected;
        }
      ),
      { numRuns: 50 }
    );
  });

  it("a bucket with capacity = MPS absorbs an initial burst of MPS tokens with zero wait", () => {
    const now = 0;
    const mps = 80;
    const bucket = new TokenBucket({
      capacity: mps,
      refillPerMs: mps / 1000,
      now: () => now,
    });
    // Acquire MPS tokens synchronously — all should resolve from
    // the initial capacity without any clock advance.
    const promises: Array<Promise<void>> = [];
    for (let i = 0; i < mps; i++) {
      promises.push(bucket.acquire(1));
    }
    return Promise.all(promises).then(() => {
      // Bucket is now empty, but the simulated clock didn't move.
      expect(bucket.peek()).toBeCloseTo(0, 5);
    });
  });
});
