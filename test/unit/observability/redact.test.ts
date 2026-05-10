import { afterEach, describe, expect, it } from "vitest";

import { hashPhoneNumberId, setRedactSalt } from "../../../src/observability/redact.js";

const DEFAULT_SALT = "@dojocoding/whatsapp:dev-default-salt";

afterEach(() => {
  setRedactSalt(DEFAULT_SALT);
});

describe("hashPhoneNumberId", () => {
  it("returns a 16-char lowercase hex", () => {
    const out = hashPhoneNumberId("PHONE_ID_12345");
    expect(out).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable across calls (same input + salt)", () => {
    expect(hashPhoneNumberId("X")).toBe(hashPhoneNumberId("X"));
  });

  it("differs from the raw input", () => {
    const raw = "PHONE_ID_12345";
    expect(hashPhoneNumberId(raw)).not.toBe(raw);
  });

  it("does NOT contain a 4-char substring of the raw input", () => {
    const raw = "PHONE_ID_12345";
    const hashed = hashPhoneNumberId(raw);
    for (let i = 0; i + 4 <= raw.length; i += 1) {
      expect(hashed).not.toContain(raw.slice(i, i + 4));
    }
  });

  it("different inputs produce different outputs", () => {
    expect(hashPhoneNumberId("A")).not.toBe(hashPhoneNumberId("B"));
  });

  it("setRedactSalt changes the hash", () => {
    setRedactSalt("salt-1");
    const a = hashPhoneNumberId("X");
    setRedactSalt("salt-2");
    const b = hashPhoneNumberId("X");
    expect(a).not.toBe(b);
  });

  it("setRedactSalt rejects empty / non-string", () => {
    expect(() => setRedactSalt("")).toThrow(TypeError);
    expect(() => setRedactSalt(undefined as unknown as string)).toThrow(TypeError);
  });
});
