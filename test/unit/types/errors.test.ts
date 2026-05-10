import { describe, expect, it } from "vitest";

import {
  MissingCredentialsError,
  MockModeError,
  RateLimitError,
  TemplateError,
  WebhookSignatureError,
  WhatsAppError,
  WindowClosedError,
} from "../../../src/types/errors.js";

describe("WhatsAppError hierarchy", () => {
  it("subclass instanceof base class and Error", () => {
    const err = new WebhookSignatureError("bad signature");
    expect(err).toBeInstanceOf(WebhookSignatureError);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).toBeInstanceOf(Error);
  });

  it("each subclass has the documented `code` discriminator", () => {
    expect(new MissingCredentialsError(["token"]).code).toBe("MISSING_CREDENTIALS");
    expect(new RateLimitError("rate").code).toBe("RATE_LIMIT");
    expect(new WindowClosedError("521234567890").code).toBe("WINDOW_CLOSED");
    expect(new WebhookSignatureError().code).toBe("WEBHOOK_SIGNATURE");
    expect(new TemplateError("bad template").code).toBe("TEMPLATE");
    expect(new MockModeError("mock").code).toBe("MOCK_MODE");
  });

  it("preserves `name` on each subclass", () => {
    expect(new MissingCredentialsError(["token"]).name).toBe("MissingCredentialsError");
    expect(new RateLimitError("rate").name).toBe("RateLimitError");
    expect(new WindowClosedError("521234567890").name).toBe("WindowClosedError");
    expect(new WebhookSignatureError().name).toBe("WebhookSignatureError");
    expect(new TemplateError("bad template").name).toBe("TemplateError");
    expect(new MockModeError("mock").name).toBe("MockModeError");
  });

  it("toJSON exposes name/code/message but does not leak credential-shaped fields", () => {
    const err = new WhatsAppError("UNKNOWN", "boom");
    Object.assign(err, {
      token: "SECRET-TOKEN-VALUE",
      appSecret: "SECRET-APPSECRET-VALUE",
    });
    const json = JSON.stringify(err);
    expect(json).toContain("WhatsAppError");
    expect(json).toContain("UNKNOWN");
    expect(json).toContain("boom");
    expect(json).not.toContain("SECRET-TOKEN-VALUE");
    expect(json).not.toContain("SECRET-APPSECRET-VALUE");
  });

  it("MissingCredentialsError exposes missingFields and the message names the fields", () => {
    const err = new MissingCredentialsError(["token", "wabaId"]);
    expect(err.missingFields).toEqual(["token", "wabaId"]);
    expect(err.message).toContain("token");
    expect(err.message).toContain("wabaId");
  });

  it("RateLimitError carries optional metaCode and retryAfterMs", () => {
    const err = new RateLimitError("pair rate limit", { metaCode: 131056, retryAfterMs: 6_000 });
    expect(err.metaCode).toBe(131056);
    expect(err.retryAfterMs).toBe(6_000);
    const empty = new RateLimitError("generic");
    expect(empty.metaCode).toBeUndefined();
    expect(empty.retryAfterMs).toBeUndefined();
  });

  it("WindowClosedError carries customerWaId in its public field", () => {
    const err = new WindowClosedError("521234567890");
    expect(err.customerWaId).toBe("521234567890");
    expect(err.message).toContain("521234567890");
  });

  it("WhatsAppError supports `cause` via options", () => {
    const root = new Error("root cause");
    const err = new WhatsAppError("UNKNOWN", "wrapped", { cause: root });
    expect((err as Error & { cause?: unknown }).cause).toBe(root);
  });

  it("`code` is readonly at the type level (compile-time check stand-in)", () => {
    const err: WhatsAppError = new WebhookSignatureError();
    expect(err.code).toBe("WEBHOOK_SIGNATURE");
    // Attempting to reassign `err.code = "RATE_LIMIT"` would fail tsc with
    // strict settings; runtime assignability is intentionally not enforced.
  });
});
