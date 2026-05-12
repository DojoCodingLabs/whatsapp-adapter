import { describe, expect, it } from "vitest";

import { classifyRetryReason, TransientHttpError } from "../../../src/client/retry.js";
import { RateLimitError, WindowClosedError } from "../../../src/types/errors.js";

describe("classifyRetryReason", () => {
  it("returns rate_limit for TransientHttpError with status 429", () => {
    expect(classifyRetryReason(new TransientHttpError("rl", undefined, 429))).toBe("rate_limit");
  });

  it("returns rate_limit for RateLimitError (Meta business code 130429)", () => {
    expect(classifyRetryReason(new RateLimitError("rl", { metaCode: 130429 }))).toBe("rate_limit");
  });

  it("returns transient_http for TransientHttpError with non-429 status", () => {
    expect(classifyRetryReason(new TransientHttpError("5xx", undefined, 503))).toBe(
      "transient_http"
    );
    expect(classifyRetryReason(new TransientHttpError("5xx", undefined, 500))).toBe(
      "transient_http"
    );
    expect(classifyRetryReason(new TransientHttpError("408", undefined, 408))).toBe(
      "transient_http"
    );
  });

  it("returns transient_http for TransientHttpError without an explicit status", () => {
    // status defaults to 0 in legacy constructions; falls to transient_http
    expect(classifyRetryReason(new TransientHttpError("legacy"))).toBe("transient_http");
  });

  it("returns network for TypeError(fetch failed)", () => {
    expect(classifyRetryReason(new TypeError("fetch failed"))).toBe("network");
  });

  it("returns abort for an Error named AbortError", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(classifyRetryReason(err)).toBe("abort");
  });

  it("returns undefined for non-retryable typed errors", () => {
    expect(classifyRetryReason(new WindowClosedError("+5210000000001"))).toBeUndefined();
  });

  it("returns undefined for plain Error", () => {
    expect(classifyRetryReason(new Error("plain"))).toBeUndefined();
  });

  it("returns undefined for non-Error values", () => {
    expect(classifyRetryReason("string")).toBeUndefined();
    expect(classifyRetryReason(null)).toBeUndefined();
    expect(classifyRetryReason(undefined)).toBeUndefined();
    expect(classifyRetryReason(42)).toBeUndefined();
  });
});

describe("TransientHttpError.status", () => {
  it("stores the status field", () => {
    expect(new TransientHttpError("x", 100, 429).status).toBe(429);
    expect(new TransientHttpError("x", 100, 503).status).toBe(503);
  });

  it("defaults to 0 when omitted (back-compat)", () => {
    expect(new TransientHttpError("legacy").status).toBe(0);
    expect(new TransientHttpError("legacy", 100).status).toBe(0);
  });

  it("preserves retryAfterMs alongside status", () => {
    const err = new TransientHttpError("x", 500, 429);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(500);
  });
});
