import {
  AuthenticationError,
  CapabilityError,
  MissingCredentialsError,
  OptOutError,
  PermissionError,
  RateLimitError,
  TemplateError,
  type WhatsAppError,
  WindowClosedError,
} from "@dojocoding/whatsapp-sdk";
import { describe, expect, it } from "vitest";

import { mapSdkError, withErrorMapping } from "../../src/errors.js";

function firstText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  const head = content[0];
  if (!head || head.text === undefined) throw new Error("expected text content");
  return head.text;
}

describe("mapSdkError: per-subclass recovery hints", () => {
  it("WindowClosedError → recommends whatsapp_send_template", () => {
    const r = mapSdkError(new WindowClosedError("+5210000000001"));
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.code).toBe("WINDOW_CLOSED");
    expect(firstText(r.content)).toMatch(/whatsapp_send_template/);
    expect(firstText(r.content)).toMatch(/24-hour/);
  });

  it("TemplateError → recommends whatsapp_get_template", () => {
    const r = mapSdkError(new TemplateError("invalid components"));
    expect(r.structuredContent.error.code).toBe("TEMPLATE");
    expect(firstText(r.content)).toMatch(/whatsapp_get_template/);
  });

  it("RateLimitError → mentions retryAfterMs when present", () => {
    const r = mapSdkError(new RateLimitError("throttled", { retryAfterMs: 1234 }));
    expect(r.structuredContent.error.code).toBe("RATE_LIMIT");
    expect(firstText(r.content)).toMatch(/1234/);
  });

  it("RateLimitError → graceful when retryAfterMs absent", () => {
    const r = mapSdkError(new RateLimitError("throttled"));
    expect(r.structuredContent.error.code).toBe("RATE_LIMIT");
    expect(firstText(r.content)).toMatch(/[Ww]ait/);
  });

  it("AuthenticationError → never leaks the token value in hint or message", () => {
    const r = mapSdkError(new AuthenticationError("bad token EAAGsuper-secret-do-not-leak"));
    const all = JSON.stringify(r);
    expect(all).not.toContain("EAAGsuper-secret-do-not-leak");
    // hint also does not include the original message text verbatim
    expect(firstText(r.content)).not.toContain("EAAG");
    expect(r.structuredContent.error.code).toBe("AUTHENTICATION");
  });

  it("PermissionError → mentions required scope", () => {
    const r = mapSdkError(new PermissionError("scope missing"));
    expect(firstText(r.content)).toMatch(/whatsapp_business_messaging/);
  });

  it("CapabilityError → quotes the message", () => {
    const r = mapSdkError(new CapabilityError("calling not enabled"));
    expect(firstText(r.content)).toMatch(/calling not enabled/);
  });

  it("MissingCredentialsError → operator-targeted hint", () => {
    const r = mapSdkError(new MissingCredentialsError(["token", "phoneNumberId"]));
    expect(firstText(r.content)).toMatch(/WHATSAPP_ACCESS_TOKEN/);
    expect(firstText(r.content)).toMatch(/WHATSAPP_PHONE_NUMBER_ID/);
  });

  it("OptOutError → recovery hint guides toward consent recording", () => {
    const r = mapSdkError(new OptOutError("+5210000000001", "MARKETING"));
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.code).toBe("OPT_OUT");
    expect(firstText(r.content)).toMatch(/opted out/i);
    expect(firstText(r.content)).toMatch(/MARKETING/);
    expect(firstText(r.content)).toMatch(/consent/i);
  });

  it("OptOutError without category → hint omits the category clause", () => {
    const r = mapSdkError(new OptOutError("+5210000000001"));
    expect(r.structuredContent.error.code).toBe("OPT_OUT");
    expect(firstText(r.content)).toMatch(/opted out/i);
    expect(firstText(r.content)).not.toMatch(/MARKETING|UTILITY|AUTHENTICATION/);
  });

  it("OptOutError → recipient redacted to last-4, full PII never leaks", () => {
    const r = mapSdkError(new OptOutError("+5210000000001", "MARKETING"));
    const all = JSON.stringify(r);
    // Full phone number must not appear anywhere in the mapped response.
    expect(all).not.toContain("+5210000000001");
    expect(all).not.toContain("521000000");
    // The redacted last-4 SHOULD appear (this is what surfaces in logs).
    expect(all).toContain("***0001");
  });

  it("structuredContent.error.code matches the SDK discriminator across all subclasses", () => {
    const cases: ReadonlyArray<{ err: WhatsAppError; code: string }> = [
      { err: new WindowClosedError("+5210000000001"), code: "WINDOW_CLOSED" },
      { err: new TemplateError("x"), code: "TEMPLATE" },
      { err: new RateLimitError("x"), code: "RATE_LIMIT" },
      { err: new AuthenticationError("x"), code: "AUTHENTICATION" },
      { err: new PermissionError("x"), code: "PERMISSION" },
      { err: new CapabilityError("x"), code: "CAPABILITY" },
      { err: new MissingCredentialsError([]), code: "MISSING_CREDENTIALS" },
      { err: new OptOutError("+5210000000001", "MARKETING"), code: "OPT_OUT" },
    ];
    for (const { err, code } of cases) {
      expect(mapSdkError(err).structuredContent.error.code).toBe(code);
    }
  });
});

describe("withErrorMapping", () => {
  it("returns the inner result on success", async () => {
    const out = await withErrorMapping(async () => ({ ok: true }));
    expect(out).toEqual({ ok: true });
  });

  it("maps a thrown WhatsAppError to a tool-error response", async () => {
    const out = await withErrorMapping(async () => {
      throw new WindowClosedError("+5210000000001");
    });
    expect(out).toMatchObject({ isError: true });
  });

  it("re-throws non-WhatsApp errors so the MCP framework surfaces them", async () => {
    await expect(
      withErrorMapping(async () => {
        throw new TypeError("not an SDK error");
      })
    ).rejects.toThrow(TypeError);
  });
});
