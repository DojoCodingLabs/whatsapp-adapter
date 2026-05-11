import { randomBytes } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { computeSignature, verifySignature } from "../../../src/webhooks/signature.js";

/**
 * Property-based assertions for the HMAC verifier. Random body /
 * secret / header inputs explore the validator's tolerance for
 * malformed input. The "either" property is the contract:
 *   verifySignature(body, sig, secret) returns true
 *   IFF sig === "sha256=" + computeSignature(body, secret)
 * regardless of byte content.
 */

describe("verifySignature: property-based", () => {
  it("verify=true iff header matches HMAC(body, secret) — 50 random vectors", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 4096 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        async (body, secret) => {
          const sig = await computeSignature(body, secret);
          const ok = await verifySignature({
            rawBody: body,
            signatureHeader: "sha256=" + sig,
            appSecret: secret,
          });
          if (!ok) return false;
          // A single bit flipped anywhere in the header MUST fail.
          const flipped = sig.slice(0, -1) + (sig[sig.length - 1] === "0" ? "1" : "0");
          const stillOk = await verifySignature({
            rawBody: body,
            signatureHeader: "sha256=" + flipped,
            appSecret: secret,
          });
          return stillOk === false;
        }
      ),
      { numRuns: 50 }
    );
  });

  it("returns false for any random hex of correct length but wrong contents — 100 vectors", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 256 }), async (body) => {
        const fakeHex = randomBytes(32).toString("hex");
        // Probability of a 256-bit collision is astronomically low.
        const ok = await verifySignature({
          rawBody: body,
          signatureHeader: "sha256=" + fakeHex,
          appSecret: "any-secret",
        });
        return ok === false;
      }),
      { numRuns: 100 }
    );
  });

  it("returns false on malformed-shape headers — never throws", async () => {
    const malformed = [
      "",
      "sha256=",
      "sha256=NOT-HEX!!",
      "abc",
      "x".repeat(100),
      "sha256=" + "a".repeat(63), // odd-length hex
      "sha256=" + "a".repeat(62), // too short for SHA-256
      "sha256=" + "a".repeat(66), // too long
    ];
    for (const m of malformed) {
      const result = await verifySignature({
        rawBody: "any body",
        signatureHeader: m,
        appSecret: "secret",
      });
      expect(result).toBe(false);
    }
  });

  it("tolerates uppercase / lowercase / mixed-case hex equivalently", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 128 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        async (body, secret) => {
          const sig = await computeSignature(body, secret);
          const lower = await verifySignature({
            rawBody: body,
            signatureHeader: "sha256=" + sig.toLowerCase(),
            appSecret: secret,
          });
          const upper = await verifySignature({
            rawBody: body,
            signatureHeader: "sha256=" + sig.toUpperCase(),
            appSecret: secret,
          });
          return lower === true && upper === true;
        }
      ),
      { numRuns: 25 }
    );
  });
});
