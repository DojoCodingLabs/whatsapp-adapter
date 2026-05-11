import { afterEach, describe, expect, it } from "vitest";

import {
  _resetRedactSaltForTests,
  DEFAULT_REDACT_SALT,
  hashPhoneNumberId,
  setRedactSalt,
} from "../../../src/observability/redact.js";

afterEach(() => {
  _resetRedactSaltForTests();
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

  it("explicit per-call salt overrides the process-wide setter", async () => {
    setRedactSalt("process-wide");
    const a = await hashPhoneNumberId("X");
    const b = await hashPhoneNumberId("X", "per-call");
    expect(a).not.toBe(b);
  });

  it("explicit per-call salt is stable (same input + salt)", async () => {
    const a = await hashPhoneNumberId("X", "tenant-a");
    const b = await hashPhoneNumberId("X", "tenant-a");
    expect(a).toBe(b);
  });

  it("different per-call salts on same input produce different hashes", async () => {
    const a = await hashPhoneNumberId("X", "tenant-a");
    const b = await hashPhoneNumberId("X", "tenant-b");
    expect(a).not.toBe(b);
  });

  it("falls back to DEFAULT_REDACT_SALT when no override and no per-call salt", async () => {
    _resetRedactSaltForTests();
    const a = await hashPhoneNumberId("X");
    const b = await hashPhoneNumberId("X", DEFAULT_REDACT_SALT);
    expect(a).toBe(b);
  });

  it("DEFAULT_REDACT_SALT is the documented v0.x default", () => {
    expect(DEFAULT_REDACT_SALT).toBe("@dojocoding/whatsapp-sdk:dev-default-salt");
  });
});
