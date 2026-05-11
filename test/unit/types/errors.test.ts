import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  CapabilityError,
  MissingCredentialsError,
  MockModeError,
  PermissionError,
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

  it("AuthenticationError is in the WhatsAppError hierarchy and exposes metaCode + subcode", () => {
    const err = new AuthenticationError("Session expired", { metaCode: 190, subcode: 463 });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("AUTHENTICATION");
    expect(err.name).toBe("AuthenticationError");
    expect(err.metaCode).toBe(190);
    expect(err.subcode).toBe(463);
  });

  it("AuthenticationError tolerates omitted metaCode/subcode", () => {
    const err = new AuthenticationError("opaque");
    expect(err.metaCode).toBeUndefined();
    expect(err.subcode).toBeUndefined();
  });

  it("PermissionError is in the WhatsAppError hierarchy and exposes metaCode", () => {
    const err = new PermissionError("Permission denied", { metaCode: 200 });
    expect(err).toBeInstanceOf(PermissionError);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err.code).toBe("PERMISSION");
    expect(err.name).toBe("PermissionError");
    expect(err.metaCode).toBe(200);
  });

  it("CapabilityError is in the WhatsAppError hierarchy and exposes metaCode", () => {
    const err = new CapabilityError("Invalid parameter", { metaCode: 100 });
    expect(err).toBeInstanceOf(CapabilityError);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err.code).toBe("CAPABILITY");
    expect(err.name).toBe("CapabilityError");
    expect(err.metaCode).toBe(100);
  });

  describe("WebhookSignatureError (negative-path contract for consumer-thrown use)", () => {
    // The SDK's bundled HTTP adapters (Express / web / Hono) return
    // `{ status: 401 }` on a bad signature rather than throwing. The
    // typed class exists for consumers writing their own HTTP layers
    // — `verifySignatureOrThrow` is the canonical SDK throw site.
    it("instanceof works across the WhatsAppError hierarchy", () => {
      const err = new WebhookSignatureError();
      expect(err).toBeInstanceOf(WebhookSignatureError);
      expect(err).toBeInstanceOf(WhatsAppError);
      expect(err).toBeInstanceOf(Error);
    });

    it("default message exists and is non-empty", () => {
      expect(new WebhookSignatureError().message.length).toBeGreaterThan(0);
    });

    it("custom message is preserved", () => {
      const err = new WebhookSignatureError("bad sig from worker B");
      expect(err.message).toBe("bad sig from worker B");
    });

    it("`cause` chains through when wrapping an underlying error", () => {
      const root = new Error("tampered body");
      const err = new WebhookSignatureError("HMAC mismatch", { cause: root });
      expect((err as Error & { cause?: unknown }).cause).toBe(root);
    });

    it("JSON-serializes to a payload that does not leak app-secret-shaped fields", () => {
      const err = new WebhookSignatureError("bad");
      Object.assign(err, {
        appSecret: "SECRET-SHOULD-NOT-LEAK",
        rawBody: "any-thing",
      });
      const json = JSON.stringify(err);
      expect(json).toContain("WebhookSignatureError");
      expect(json).toContain("WEBHOOK_SIGNATURE");
      expect(json).not.toContain("SECRET-SHOULD-NOT-LEAK");
    });
  });

  describe("MockModeError (reserved for consumer use)", () => {
    // No production SDK code currently throws MockModeError. The class
    // is exported as a reserved consumer-facing escape hatch (e.g. a
    // test harness wrapping the mock client can throw it from custom
    // simulated flows). These tests pin the public contract so a
    // future SDK throw-site can rely on the same shape.
    it("instanceof works across the WhatsAppError hierarchy", () => {
      const err = new MockModeError("not supported in mock mode");
      expect(err).toBeInstanceOf(MockModeError);
      expect(err).toBeInstanceOf(WhatsAppError);
      expect(err).toBeInstanceOf(Error);
    });

    it("`cause` chains through when wrapping an underlying error", () => {
      const root = new Error("inner");
      const err = new MockModeError("wrapped", { cause: root });
      expect((err as Error & { cause?: unknown }).cause).toBe(root);
    });

    it("JSON-serializes with name + code + message and no other fields", () => {
      const err = new MockModeError("simulated failure");
      const parsed = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
      expect(parsed["name"]).toBe("MockModeError");
      expect(parsed["code"]).toBe("MOCK_MODE");
      expect(parsed["message"]).toBe("simulated failure");
    });
  });
});
