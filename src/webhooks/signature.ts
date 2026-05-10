import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifySignatureInput {
  /** Raw body BYTES Meta sent. Strings are UTF-8 encoded; do not pre-parse. */
  rawBody: Buffer | Uint8Array | string;
  /** The `X-Hub-Signature-256` header value. May or may not include the `sha256=` prefix. */
  signatureHeader: string | null | undefined;
  /** Your Meta app secret. */
  appSecret: string;
}

const HEX_PREFIX = "sha256=";

/**
 * Timing-safe HMAC-SHA256 verification of an incoming webhook body.
 *
 * Returns `true` if and only if the HMAC of the raw body, keyed with
 * `appSecret`, matches the hex value in `signatureHeader`. Returns
 * `false` (without throwing) on every other input — including missing
 * header, malformed hex, or wrong byte length.
 */
export function verifySignature({
  rawBody,
  signatureHeader,
  appSecret,
}: VerifySignatureInput): boolean {
  if (typeof signatureHeader !== "string" || signatureHeader.length === 0) {
    return false;
  }
  const provided = signatureHeader.startsWith(HEX_PREFIX)
    ? signatureHeader.slice(HEX_PREFIX.length)
    : signatureHeader;
  if (!/^[0-9a-fA-F]+$/.test(provided)) {
    return false;
  }
  if (provided.length % 2 !== 0) {
    return false;
  }
  const expectedHex = computeSignature(rawBody, appSecret);
  if (provided.length !== expectedHex.length) {
    return false;
  }
  const a = Buffer.from(provided.toLowerCase(), "hex");
  const b = Buffer.from(expectedHex, "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Compute the lowercase-hex `HMAC-SHA256(appSecret, rawBody)`. Exposed
 * primarily so test fixtures can produce the expected header value.
 */
export function computeSignature(rawBody: Buffer | Uint8Array | string, appSecret: string): string {
  const hmac = createHmac("sha256", appSecret);
  hmac.update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody);
  return hmac.digest("hex");
}
