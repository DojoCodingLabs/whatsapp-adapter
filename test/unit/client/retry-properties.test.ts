import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fullJitterDelay, type RetryPolicy } from "../../../src/client/retry.js";

/**
 * Property assertions for the retry backoff math. The contract:
 *
 *   floorMs ≤ result ≤ min(maxDelayMs, baseDelayMs * 2^(attempt-1))
 *
 * Holds for any attempt ≥ 1, any policy with positive numeric
 * fields, and any rng output in [0, 1).
 */

const POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 100,
  maxDelayMs: 8_000,
  jitter: "full",
  floorMs: 50,
};

describe("fullJitterDelay: property-based", () => {
  it("result is in [floorMs, min(maxDelayMs, expCap)] for any rng — 200 vectors", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (attempt, rngValue) => {
          // fc.double can return 1.0; clamp into [0, 1) per the
          // `random` contract.
          const clamped = rngValue >= 1 ? 0.999_999 : rngValue;
          const delay = fullJitterDelay(attempt, POLICY, () => clamped);
          const exp = POLICY.baseDelayMs * 2 ** (attempt - 1);
          const cap = Math.min(POLICY.maxDelayMs, exp);
          if (delay < POLICY.floorMs) return false;
          if (delay > Math.max(POLICY.floorMs, cap)) return false;
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });

  it("rng returning 0 produces exactly floorMs (no zero-ms hammering)", () => {
    for (let attempt = 1; attempt <= 8; attempt++) {
      const delay = fullJitterDelay(attempt, POLICY, () => 0);
      expect(delay).toBe(POLICY.floorMs);
    }
  });

  it("rng returning 0.999… approaches the capped exponential value", () => {
    // attempt 1: exp = 100, capped at 8_000 → 100 * ~0.999
    expect(fullJitterDelay(1, POLICY, () => 0.999)).toBeCloseTo(99.9, 1);
    // attempt 8: exp = 12_800, capped at 8_000 → 8_000 * ~0.999
    expect(fullJitterDelay(8, POLICY, () => 0.999)).toBeCloseTo(7992, 0);
  });

  it("monotonic ceiling: attempt N+1 cap ≥ attempt N cap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (attempt) => {
        const expN = Math.min(POLICY.maxDelayMs, POLICY.baseDelayMs * 2 ** (attempt - 1));
        const expN1 = Math.min(POLICY.maxDelayMs, POLICY.baseDelayMs * 2 ** attempt);
        return expN1 >= expN;
      }),
      { numRuns: 50 }
    );
  });
});
