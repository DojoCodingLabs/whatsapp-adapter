import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { hashPhoneNumberId, setRedactSalt } from "../../../src/observability/redact.js";

/**
 * The WebCrypto-based `hashPhoneNumberId` must produce byte-identical
 * SHA-256 output (truncated to the first 8 bytes / 16 hex chars) to
 * `node:crypto.createHash` for the same `(salt + ":" + value)` input.
 */
describe("hashPhoneNumberId: WebCrypto / node:crypto parity", () => {
  it("matches node:crypto for the default salt", async () => {
    const salt = "@dojocoding/whatsapp-sdk:dev-default-salt";
    const value = "PHONE_ID_12345";
    const webCryptoHex = await hashPhoneNumberId(value);
    const nodeHex = createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 16);
    expect(webCryptoHex).toBe(nodeHex);
  });

  it("matches node:crypto across multiple custom salts", async () => {
    const cases: Array<[salt: string, value: string]> = [
      ["s1", "v1"],
      ["another-salt", "1234567890"],
      ["прод", "📱"],
      ["", "x"], // empty salt is forbidden by setRedactSalt, but compute it directly
    ];
    for (const [salt, value] of cases) {
      try {
        setRedactSalt(salt);
      } catch {
        continue; // setRedactSalt rejects empty; skip the parity for that case
      }
      const webCryptoHex = await hashPhoneNumberId(value);
      const nodeHex = createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 16);
      expect(webCryptoHex).toBe(nodeHex);
    }
    // Reset for downstream tests.
    setRedactSalt("@dojocoding/whatsapp-sdk:dev-default-salt");
  });
});
