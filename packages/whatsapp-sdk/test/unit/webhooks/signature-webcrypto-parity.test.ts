import { createHmac, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { computeSignature } from "../../../src/webhooks/signature.js";

/**
 * Parity vectors: the WebCrypto-based `computeSignature` must produce
 * byte-identical HMAC-SHA256 output to `node:crypto.createHmac` for
 * the same inputs. If this drifts, every existing webhook signature
 * verified on Node will silently mismatch on Workers / Bun / Deno
 * (and vice versa).
 */
describe("signature: WebCrypto / node:crypto parity", () => {
  it("produces identical hex digests for a small string body", async () => {
    const body = "hello world";
    const secret = "test-secret";
    const webCryptoHex = await computeSignature(body, secret);
    const nodeHex = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(webCryptoHex).toBe(nodeHex);
  });

  it("produces identical hex digests for an empty body", async () => {
    const secret = "any";
    expect(await computeSignature("", secret)).toBe(
      createHmac("sha256", secret).update("", "utf8").digest("hex")
    );
  });

  it("produces identical hex digests across 50 random vectors", async () => {
    for (let i = 0; i < 50; i += 1) {
      const body = randomBytes(64);
      const secret = randomBytes(16).toString("hex");
      const webCryptoHex = await computeSignature(body, secret);
      const nodeHex = createHmac("sha256", secret).update(body).digest("hex");
      expect(webCryptoHex).toBe(nodeHex);
    }
  });

  it("handles Uint8Array input identically to Buffer input", async () => {
    const buf = randomBytes(128);
    const u8 = new Uint8Array(buf);
    const secret = "k";
    const fromBuffer = await computeSignature(buf, secret);
    const fromU8 = await computeSignature(u8, secret);
    expect(fromBuffer).toBe(fromU8);
  });
});
