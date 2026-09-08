import {
  AccountRestrictedError,
  AuthenticationError,
  CapabilityError,
  MissingCredentialsError,
  NetworkError,
  OptOutError,
  PermissionError,
  RateLimitError,
  RequestAbortedError,
  TemplateError,
  TransientError,
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

  it("OptOutError from Meta (131050) → hint says the opt-out is authoritative", () => {
    const res = mapSdkError(new OptOutError("+5210000000001", "MARKETING", { metaCode: 131050 }));
    expect(firstText(res.content)).toContain("131050");
    expect(firstText(res.content)).toContain("authoritative");
  });

  it("TemplateError with metaCode → hint quotes the Meta error code", () => {
    const res = mapSdkError(
      new TemplateError("Template name does not exist", undefined, { metaCode: 132001 })
    );
    expect(firstText(res.content)).toContain("132001");
    expect(firstText(res.content)).toContain("whatsapp_get_template");
  });

  it("RateLimitError 131049 (per-user marketing cap) → hint says wait 24 h, no backoff retry", () => {
    const res = mapSdkError(new RateLimitError("x", { metaCode: 131049 }));
    expect(firstText(res.content)).toContain("24 hours");
    expect(firstText(res.content)).toContain("131049");
  });

  it("RateLimitError 131064 (classification enforcement) → operator-targeted hint", () => {
    const res = mapSdkError(new RateLimitError("x", { metaCode: 131064 }));
    expect(firstText(res.content)).toContain("131064");
    expect(firstText(res.content)).toContain("WhatsApp Manager");
  });

  it("AccountRestrictedError → stop sending, surface to a human", () => {
    const res = mapSdkError(new AccountRestrictedError("blocked", { metaCode: 368 }));
    expect(res.structuredContent.error.code).toBe("ACCOUNT_RESTRICTED");
    expect(firstText(res.content)).toContain("Stop attempting sends");
  });

  it("TransientError → warns the send may have gone through before re-sending", () => {
    const res = mapSdkError(new TransientError("x", { httpStatus: 503, attempts: 4 }));
    expect(res.structuredContent.error.code).toBe("TRANSIENT");
    expect(firstText(res.content)).toContain("HTTP 503");
    expect(firstText(res.content)).toContain("duplicate");
  });

  it("NetworkError → safe to retry, request never reached Meta", () => {
    const res = mapSdkError(new NetworkError("fetch failed"));
    expect(res.structuredContent.error.code).toBe("NETWORK");
    expect(firstText(res.content)).toContain("never reached Meta");
  });

  it("RequestAbortedError → retry if unintended", () => {
    const res = mapSdkError(new RequestAbortedError());
    expect(res.structuredContent.error.code).toBe("ABORTED");
    expect(firstText(res.content)).toContain("cancelled");
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
      { err: new AccountRestrictedError("x"), code: "ACCOUNT_RESTRICTED" },
      { err: new TransientError("x"), code: "TRANSIENT" },
      { err: new NetworkError("x"), code: "NETWORK" },
      { err: new RequestAbortedError(), code: "ABORTED" },
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
