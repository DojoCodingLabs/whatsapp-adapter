import { timingSafeEqual } from "node:crypto";

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

/**
 * Verify Meta's GET-based webhook handshake. Returns the `challenge`
 * value when `mode === "subscribe"` AND `verifyToken === expectedToken`
 * (constant-time compare). Returns `null` for every other input — the
 * caller SHOULD respond `403 Forbidden`.
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
  if (verifyToken.length !== expectedToken.length) return null;
  const a = Buffer.from(verifyToken, "utf8");
  const b = Buffer.from(expectedToken, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return typeof challenge === "string" ? challenge : null;
}
