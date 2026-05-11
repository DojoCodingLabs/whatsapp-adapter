let redactSalt = "@dojocoding/whatsapp-sdk:dev-default-salt";
const encoder = new TextEncoder();

/**
 * Set the salt used by `hashPhoneNumberId` (and friends) for PII redaction.
 * Production deployments SHOULD set this once at boot to a per-environment
 * value so spans across runs / replicas correlate consistently within an
 * environment but differ across environments.
 */
export function setRedactSalt(salt: string): void {
  if (typeof salt !== "string" || salt.length === 0) {
    throw new TypeError("setRedactSalt: salt must be a non-empty string.");
  }
  redactSalt = salt;
}

/**
 * Stable, salted SHA-256 hash truncated to 16 lowercase-hex characters.
 * Suitable for tagging OTel spans without leaking the raw phone number id.
 *
 * Runtime-portable: uses `crypto.subtle.digest("SHA-256", ...)` so the
 * function runs unmodified on Node ≥ 20, Cloudflare Workers, Bun, Deno,
 * and any WinterCG runtime.
 */
export async function hashPhoneNumberId(value: string): Promise<string> {
  const input = encoder.encode(`${redactSalt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const bytes = new Uint8Array(digest);
  // 8 bytes → 16 hex chars; only the prefix is needed.
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}
