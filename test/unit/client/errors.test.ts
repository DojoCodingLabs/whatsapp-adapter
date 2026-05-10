import { describe, expect, it } from "vitest";

import {
  isRetryableError,
  isRetryableHttpStatus,
  mapMetaError,
} from "../../../src/client/errors.js";
import {
  RateLimitError,
  TemplateError,
  WhatsAppError,
  WindowClosedError,
} from "../../../src/types/errors.js";

describe("mapMetaError", () => {
  it("131056 → RateLimitError(metaCode=131056)", () => {
    const err = mapMetaError(400, {
      error: { code: 131056, message: "(#131056) pair rate limit" },
    });
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).metaCode).toBe(131056);
  });

  it.each([130429, 131048, 131053] as const)("%i → RateLimitError", (code) => {
    const err = mapMetaError(400, { error: { code, message: `(#${code})` } });
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).metaCode).toBe(code);
  });

  it("131026 → WindowClosedError, extracts recipient when present", () => {
    const err = mapMetaError(400, {
      error: {
        code: 131026,
        message: "(#131026) Re-engagement message",
        error_data: { recipient_phone_number: "521234567890" },
      },
    });
    expect(err).toBeInstanceOf(WindowClosedError);
    expect((err as WindowClosedError).customerWaId).toBe("521234567890");
  });

  it("131026 without recipient still returns WindowClosedError", () => {
    const err = mapMetaError(400, {
      error: { code: 131026, message: "(#131026)" },
    });
    expect(err).toBeInstanceOf(WindowClosedError);
    expect((err as WindowClosedError).customerWaId).toBe("<unknown>");
  });

  it.each([132000, 132012, 132999] as const)("%i (132xxx range) → TemplateError", (code) => {
    const err = mapMetaError(400, {
      error: { code, message: "Number of parameters does not match" },
    });
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.message).toContain("Number of parameters");
  });

  it("133000 (just outside template range) is NOT a TemplateError", () => {
    const err = mapMetaError(400, { error: { code: 133000, message: "Other" } });
    expect(err).not.toBeInstanceOf(TemplateError);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err.code).toBe("UNKNOWN");
  });

  it("non-JSON / plain-text body falls back to WhatsAppError(UNKNOWN)", () => {
    const err = mapMetaError(502, "<html>nginx 502</html>");
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toContain("502");
    expect(err.message).toContain("nginx");
  });

  it("undefined body falls back to WhatsAppError(UNKNOWN)", () => {
    const err = mapMetaError(500, undefined);
    expect(err.code).toBe("UNKNOWN");
  });

  it("unrecognised code falls back to WhatsAppError(UNKNOWN) preserving message", () => {
    const err = mapMetaError(400, {
      error: { code: 100, message: "Invalid parameter" },
    });
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toContain("Invalid parameter");
  });
});

describe("isRetryableError", () => {
  it.each([130429, 131048, 131056, 131053] as const)(
    "RateLimitError with metaCode %i is retryable",
    (metaCode) => {
      expect(isRetryableError(new RateLimitError("rl", { metaCode }))).toBe(true);
    }
  );

  it("RateLimitError without metaCode is not retryable", () => {
    expect(isRetryableError(new RateLimitError("rl"))).toBe(false);
  });

  it("Non-RateLimit errors are not retryable", () => {
    expect(isRetryableError(new WindowClosedError("521234567890"))).toBe(false);
    expect(isRetryableError(new WhatsAppError("UNKNOWN", "boom"))).toBe(false);
    expect(isRetryableError(new Error("plain"))).toBe(false);
  });
});

describe("isRetryableHttpStatus", () => {
  it.each([408, 429, 500, 502, 503, 504, 599] as const)("%i is retryable", (status) =>
    expect(isRetryableHttpStatus(status)).toBe(true)
  );

  it.each([200, 201, 301, 400, 401, 403, 404, 422] as const)("%i is NOT retryable", (status) =>
    expect(isRetryableHttpStatus(status)).toBe(false)
  );
});
