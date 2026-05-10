export interface VerifyHandshakeInput {
  /** `hub.mode` query param sent by Meta. */
  mode: string | null | undefined;
  /** `hub.verify_token` query param sent by Meta. */
  verifyToken: string | null | undefined;
  /** `hub.challenge` query param sent by Meta. */
  challenge: string | null | undefined;
  /** The verify-token shared secret you registered in Meta's webhook UI. */
  expectedToken: string;
}

const encoder = new TextEncoder();

/**
 * Verify Meta's GET-based webhook handshake. Returns the `challenge`
 * value when `mode === "subscribe"` AND `verifyToken === expectedToken`
 * (constant-time compare). Returns `null` for every other input — the
 * caller SHOULD respond `403 Forbidden`.
 *
 * Runtime-portable: uses an explicit constant-time byte-wise compare
 * rather than `node:crypto.timingSafeEqual`, so the function runs
 * unmodified on Cloudflare Workers, Bun, Deno, and any WinterCG runtime.
 */
export function verifyHandshake({
  mode,
  verifyToken,
  challenge,
  expectedToken,
}: VerifyHandshakeInput): string | null {
  if (mode !== "subscribe") return null;
  if (typeof verifyToken !== "string" || typeof expectedToken !== "string") return null;
  if (verifyToken.length === 0 || expectedToken.length === 0) return null;
  // Length mismatch leaks one bit (the length of expectedToken), which is
  // already public-ish — the verify-token is shared with Meta's UI. The
  // constant-time compare below protects the byte values.
  if (verifyToken.length !== expectedToken.length) return null;
  const a = encoder.encode(verifyToken);
  const b = encoder.encode(expectedToken);
  if (a.length !== b.length) return null;
  if (!constantTimeEqual(a, b)) return null;
  return typeof challenge === "string" ? challenge : null;
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
