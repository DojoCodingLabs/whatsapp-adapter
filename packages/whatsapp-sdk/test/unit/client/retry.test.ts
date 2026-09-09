import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RETRY_POLICY,
  fullJitterDelay,
  parseRetryAfter,
  retry,
  TransientHttpError,
} from "../../../src/client/retry.js";
import { RateLimitError, WhatsAppError, WindowClosedError } from "../../../src/types/errors.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const fastPolicy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 1000 };

describe("parseRetryAfter", () => {
  it("returns undefined for null / empty / nonsense", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("   ")).toBeUndefined();
    expect(parseRetryAfter("nonsense")).toBeUndefined();
  });

  it("interprets numeric seconds", () => {
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("2")).toBe(2_000);
    expect(parseRetryAfter("12.5")).toBe(12_500);
  });

  it("interprets HTTP-date relative to a fixed `now`", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const fiveSecLater = new Date(now + 5_000).toUTCString();
    expect(parseRetryAfter(fiveSecLater, now)).toBe(5_000);
  });

  it("never returns a negative delay for an HTTP-date in the past", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const past = new Date(now - 5_000).toUTCString();
    expect(parseRetryAfter(past, now)).toBe(0);
  });
});

describe("fullJitterDelay", () => {
  it("is bounded by [floor, min(maxDelayMs, base * 2^(attempt-1))]", () => {
    const policy = { ...DEFAULT_RETRY_POLICY };
    const samples = Array.from({ length: 200 }, () => fullJitterDelay(3, policy));
    const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 4);
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(policy.floorMs);
      expect(s).toBeLessThanOrEqual(cap);
    }
  });

  it("respects the floor when random rolls 0", () => {
    const delay = fullJitterDelay(1, DEFAULT_RETRY_POLICY, () => 0);
    expect(delay).toBe(DEFAULT_RETRY_POLICY.floorMs);
  });

  it("hits the cap when random rolls just below 1", () => {
    const policy = { ...DEFAULT_RETRY_POLICY };
    const delay = fullJitterDelay(10, policy, () => 0.999_999);
    expect(delay).toBeLessThanOrEqual(policy.maxDelayMs);
    expect(delay).toBeGreaterThan(policy.maxDelayMs - 1);
  });
});

describe("retry()", () => {
  it("returns immediately on attempt 1 success", async () => {
    const fn = vi.fn(() => Promise.resolve("ok"));
    await expect(retry(fn, fastPolicy, { sleep: () => Promise.resolve() })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on TransientHttpError and eventually succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(() => {
      calls += 1;
      if (calls < 3) throw new TransientHttpError("503", undefined);
      return Promise.resolve("ok");
    });
    const sleep = vi.fn(() => Promise.resolve());
    await expect(retry(fn, fastPolicy, { sleep, random: () => 0.5 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("retries on retryable RateLimitError (metaCode in retryable set)", async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      if (calls < 2) throw new RateLimitError("pair rate limit", { metaCode: 131056 });
      return Promise.resolve("ok");
    };
    await expect(retry(fn, fastPolicy, { sleep: () => Promise.resolve() })).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("does NOT retry on WindowClosedError", async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      throw new WindowClosedError("521234567890");
    };
    await expect(retry(fn, fastPolicy, { sleep: () => Promise.resolve() })).rejects.toBeInstanceOf(
      WindowClosedError
    );
    expect(calls).toBe(1);
  });

  it("does NOT retry on a generic WhatsAppError(UNKNOWN)", async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      throw new WhatsAppError("UNKNOWN", "boom");
    };
    await expect(retry(fn, fastPolicy, { sleep: () => Promise.resolve() })).rejects.toBeInstanceOf(
      WhatsAppError
    );
    expect(calls).toBe(1);
  });

  it("stops at maxAttempts when failure is persistent", async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      throw new TransientHttpError("503");
    };
    await expect(retry(fn, fastPolicy, { sleep: () => Promise.resolve() })).rejects.toBeInstanceOf(
      TransientHttpError
    );
    expect(calls).toBe(fastPolicy.maxAttempts);
  });

  it("honours a numeric Retry-After hint on TransientHttpError", async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      if (calls < 2) throw new TransientHttpError("429", 1_500);
      return Promise.resolve("ok");
    };
    const sleep = vi.fn(() => Promise.resolve());
    await retry(fn, fastPolicy, { sleep, random: () => 0.001 });
    // Retry-After should override the random jitter, capped to maxDelayMs.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_000); // capped to fastPolicy.maxDelayMs
  });

  it("retries on `TypeError: fetch failed` (network drop)", async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      if (calls < 2) throw new TypeError("fetch failed");
      return Promise.resolve("ok");
    };
    await expect(retry(fn, fastPolicy, { sleep: () => Promise.resolve() })).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("retries on an AbortError that is NOT the caller's signal (e.g. fetch-internal timeout)", async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      if (calls < 2) {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      return Promise.resolve("ok");
    };
    await expect(retry(fn, fastPolicy, { sleep: () => Promise.resolve() })).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  describe("caller-initiated abort (audit F6)", () => {
    function abortError(): Error {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      return err;
    }

    it("a pre-aborted signal makes exactly one attempt and never sleeps", async () => {
      const ac = new AbortController();
      ac.abort();
      let calls = 0;
      const sleep = vi.fn(() => Promise.resolve());
      const onRetry = vi.fn();
      const fn = () => {
        calls += 1;
        return Promise.reject(abortError());
      };
      await expect(
        retry(fn, fastPolicy, { sleep, onRetry, signal: ac.signal })
      ).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(calls).toBe(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(onRetry).not.toHaveBeenCalled();
    });

    it("an abort after a retryable failure stops the loop even though the error was retryable", async () => {
      const ac = new AbortController();
      let calls = 0;
      const fn = () => {
        calls += 1;
        ac.abort(); // caller cancels while the 503 is in flight
        return Promise.reject(new TransientHttpError("503", undefined, 503));
      };
      await expect(
        retry(fn, fastPolicy, { sleep: () => Promise.resolve(), signal: ac.signal })
      ).rejects.toBeInstanceOf(TransientHttpError);
      expect(calls).toBe(1);
    });

    it("aborting during the backoff sleep cuts the sleep short and surfaces the abort", async () => {
      const ac = new AbortController();
      let calls = 0;
      const fn = () => {
        calls += 1;
        return Promise.reject(new TransientHttpError("503", undefined, 503));
      };
      // Real (fake-timer) sleep of up to 1s; we abort after 10ms.
      const promise = retry(fn, fastPolicy, { signal: ac.signal });
      const settled = promise.then(
        () => "resolved",
        (err: unknown) => err
      );
      await vi.advanceTimersByTimeAsync(10);
      ac.abort();
      await vi.advanceTimersByTimeAsync(0);
      const outcome = await settled;
      expect(outcome).toMatchObject({ name: "AbortError" });
      expect(calls).toBe(1);
    });

    it("surfaces signal.reason when it is an Error", async () => {
      const ac = new AbortController();
      const reason = new Error("user navigated away");
      const fn = () => Promise.reject(new TransientHttpError("503", undefined, 503));
      const promise = retry(fn, fastPolicy, { signal: ac.signal });
      const settled = promise.then(
        () => "resolved",
        (err: unknown) => err
      );
      await vi.advanceTimersByTimeAsync(1);
      ac.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(await settled).toBe(reason);
    });

    it("an un-aborted signal does not interfere with normal retries", async () => {
      const ac = new AbortController();
      let calls = 0;
      const fn = () => {
        calls += 1;
        if (calls < 3) return Promise.reject(new TransientHttpError("503", undefined, 503));
        return Promise.resolve("ok");
      };
      await expect(
        retry(fn, fastPolicy, { sleep: () => Promise.resolve(), signal: ac.signal })
      ).resolves.toBe("ok");
      expect(calls).toBe(3);
    });
  });
});
