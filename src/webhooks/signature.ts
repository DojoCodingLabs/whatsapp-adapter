import { WebhookSignatureError } from "../types/errors.js";

export interface VerifySignatureInput {
  /** Raw body BYTES Meta sent. Strings are UTF-8 encoded; do not pre-parse. */
  rawBody: Buffer | Uint8Array | string;
  /** The `X-Hub-Signature-256` header value. May or may not include the `sha256=` prefix. */
  signatureHeader: string | null | undefined;
  /** Your Meta app secret. */
  appSecret: string;
}

const HEX_PREFIX = "sha256=";
const HEX_RE = /^[0-9a-fA-F]+$/;
const encoder = new TextEncoder();

/**
 * Timing-safe HMAC-SHA256 verification of an incoming webhook body.
 *
 * Resolves to `true` if and only if the HMAC of the raw body, keyed with
 * `appSecret`, matches the hex value in `signatureHeader`. Resolves to
 * `false` (without rejecting) on every other input — including missing
 * header, malformed hex, or wrong byte length.
 *
 * Uses WebCrypto (`crypto.subtle.sign`) so the function runs unmodified
 * on Node ≥ 20, Cloudflare Workers, Bun, Deno, and any WinterCG runtime.
 */
export async function verifySignature({
  rawBody,
  signatureHeader,
  appSecret,
}: VerifySignatureInput): Promise<boolean> {
  if (typeof signatureHeader !== "string" || signatureHeader.length === 0) {
    return false;
  }
  const provided = signatureHeader.startsWith(HEX_PREFIX)
    ? signatureHeader.slice(HEX_PREFIX.length)
    : signatureHeader;
  if (!HEX_RE.test(provided) || provided.length % 2 !== 0) {
    return false;
  }
  const expectedBytes = await computeSignatureBytes(rawBody, appSecret);
  if (provided.length !== expectedBytes.length * 2) {
    return false;
  }
  const providedBytes = hexToBytes(provided);
  return constantTimeEqual(providedBytes, expectedBytes);
}

/**
 * Throwing variant of {@link verifySignature}. Resolves to `void` on a
 * valid signature; throws `WebhookSignatureError` on any failure (bad
 * HMAC, missing header, malformed hex, wrong byte length).
 *
 * Use this when wiring your own HTTP layer (i.e. not the SDK's
 * Express / web / Hono adapters) and you want to surface a typed
 * error rather than branch on a boolean. The SDK's bundled adapters
 * use the boolean variant and return `401` directly.
 */
export async function verifySignatureOrThrow(input: VerifySignatureInput): Promise<void> {
  const ok = await verifySignature(input);
  if (!ok) {
    throw new WebhookSignatureError();
  }
}

/**
 * Compute the lowercase-hex `HMAC-SHA256(appSecret, rawBody)`. Exposed
 * primarily so test fixtures can produce the expected header value.
 */
export async function computeSignature(
  rawBody: Buffer | Uint8Array | string,
  appSecret: string
): Promise<string> {
  return bytesToHex(await computeSignatureBytes(rawBody, appSecret));
}

async function computeSignatureBytes(
  rawBody: Buffer | Uint8Array | string,
  appSecret: string
): Promise<Uint8Array> {
  const bodyBytes = typeof rawBody === "string" ? encoder.encode(rawBody) : toUint8Array(rawBody);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, bodyBytes);
  return new Uint8Array(signature);
}

function toUint8Array(buf: Buffer | Uint8Array): Uint8Array {
  // Buffer is a Uint8Array subclass; same prototype chain, no copy needed.
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

function hexToBytes(hex: string): Uint8Array {
  const lower = hex.toLowerCase();
  const out = new Uint8Array(lower.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(lower.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Constant-time byte-wise compare for fixed-length `Uint8Array`s. No
 * early-exit on first mismatch — runtime is bounded by `a.length`
 * regardless of where the inputs differ.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}
