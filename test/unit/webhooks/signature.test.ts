import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { computeSignature, verifySignature } from "../../../src/webhooks/signature.js";

const APP_SECRET = "test-app-secret-very-secret";
const BODY = Buffer.from(
  JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
  "utf8"
);

describe("verifySignature", () => {
  it("returns true for a correctly computed signature with `sha256=` prefix", () => {
    const sig = "sha256=" + computeSignature(BODY, APP_SECRET);
    expect(verifySignature({ rawBody: BODY, signatureHeader: sig, appSecret: APP_SECRET })).toBe(
      true
    );
  });

  it("returns true when prefix is omitted (just hex)", () => {
    const sig = computeSignature(BODY, APP_SECRET);
    expect(verifySignature({ rawBody: BODY, signatureHeader: sig, appSecret: APP_SECRET })).toBe(
      true
    );
  });

  it("returns true with uppercase hex", () => {
    const sig = computeSignature(BODY, APP_SECRET).toUpperCase();
    expect(verifySignature({ rawBody: BODY, signatureHeader: sig, appSecret: APP_SECRET })).toBe(
      true
    );
  });

  it("returns false when the body is altered by one byte", () => {
    const sig = computeSignature(BODY, APP_SECRET);
    const tamper = Buffer.from(BODY);
    tamper[10] = (tamper[10]! ^ 0x01) & 0xff;
    expect(verifySignature({ rawBody: tamper, signatureHeader: sig, appSecret: APP_SECRET })).toBe(
      false
    );
  });

  it("returns false when the appSecret is wrong", () => {
    const sig = computeSignature(BODY, APP_SECRET);
    expect(
      verifySignature({ rawBody: BODY, signatureHeader: sig, appSecret: "wrong-secret" })
    ).toBe(false);
  });

  it("returns false on missing / empty header", () => {
    expect(verifySignature({ rawBody: BODY, signatureHeader: null, appSecret: APP_SECRET })).toBe(
      false
    );
    expect(
      verifySignature({ rawBody: BODY, signatureHeader: undefined, appSecret: APP_SECRET })
    ).toBe(false);
    expect(verifySignature({ rawBody: BODY, signatureHeader: "", appSecret: APP_SECRET })).toBe(
      false
    );
    expect(
      verifySignature({ rawBody: BODY, signatureHeader: "sha256=", appSecret: APP_SECRET })
    ).toBe(false);
  });

  it("returns false on non-hex characters", () => {
    expect(
      verifySignature({
        rawBody: BODY,
        signatureHeader: "sha256=NOT-HEX-AT-ALL!!!",
        appSecret: APP_SECRET,
      })
    ).toBe(false);
  });

  it("returns false on hex of wrong length (odd / wrong digest size)", () => {
    expect(
      verifySignature({ rawBody: BODY, signatureHeader: "sha256=abc", appSecret: APP_SECRET })
    ).toBe(false);
    // 32 hex chars = 16 bytes, not 32 bytes
    const tooShort = "a".repeat(32);
    expect(
      verifySignature({ rawBody: BODY, signatureHeader: tooShort, appSecret: APP_SECRET })
    ).toBe(false);
  });

  it("accepts string bodies (utf-8 encoded internally)", () => {
    const text = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const sig = computeSignature(text, APP_SECRET);
    expect(verifySignature({ rawBody: text, signatureHeader: sig, appSecret: APP_SECRET })).toBe(
      true
    );
  });

  it("accepts Uint8Array bodies", () => {
    const u8 = new Uint8Array(BODY);
    const sig = computeSignature(u8, APP_SECRET);
    expect(verifySignature({ rawBody: u8, signatureHeader: sig, appSecret: APP_SECRET })).toBe(
      true
    );
  });

  it("HMAC fuzz: 200 random body × random sig pairings — verify=true iff HMAC matches", () => {
    let trueCount = 0;
    for (let i = 0; i < 200; i += 1) {
      const body = randomBytes(64);
      const realSig = computeSignature(body, APP_SECRET);
      const useReal = i % 3 === 0;
      const candidate = useReal ? realSig : randomBytes(32).toString("hex");
      const ok = verifySignature({
        rawBody: body,
        signatureHeader: candidate,
        appSecret: APP_SECRET,
      });
      if (useReal) {
        expect(ok).toBe(true);
        trueCount += 1;
      } else {
        expect(ok).toBe(false);
      }
    }
    expect(trueCount).toBeGreaterThan(0);
  });
});
