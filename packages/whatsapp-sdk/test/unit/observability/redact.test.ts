import { afterEach, describe, expect, it } from "vitest";

import { hashPhoneNumberId, setRedactSalt } from "../../../src/observability/redact.js";

const DEFAULT_SALT = "@dojocoding/whatsapp-sdk:dev-default-salt";

afterEach(() => {
  setRedactSalt(DEFAULT_SALT);
});

describe("hashPhoneNumberId", () => {
  it("returns a 16-char lowercase hex", async () => {
    const out = await hashPhoneNumberId("PHONE_ID_12345");
    expect(out).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable across calls (same input + salt)", async () => {
    expect(await hashPhoneNumberId("X")).toBe(await hashPhoneNumberId("X"));
  });

  it("differs from the raw input", async () => {
    const raw = "PHONE_ID_12345";
    expect(await hashPhoneNumberId(raw)).not.toBe(raw);
  });

  it("does NOT contain a 4-char substring of the raw input", async () => {
    const raw = "PHONE_ID_12345";
    const hashed = await hashPhoneNumberId(raw);
    for (let i = 0; i + 4 <= raw.length; i += 1) {
      expect(hashed).not.toContain(raw.slice(i, i + 4));
    }
  });

  it("different inputs produce different outputs", async () => {
    expect(await hashPhoneNumberId("A")).not.toBe(await hashPhoneNumberId("B"));
  });

  it("setRedactSalt changes the hash", async () => {
    setRedactSalt("salt-1");
    const a = await hashPhoneNumberId("X");
    setRedactSalt("salt-2");
    const b = await hashPhoneNumberId("X");
    expect(a).not.toBe(b);
  });

  it("setRedactSalt rejects empty / non-string", () => {
    expect(() => setRedactSalt("")).toThrow(TypeError);
    expect(() => setRedactSalt(undefined as unknown as string)).toThrow(TypeError);
  });
});
