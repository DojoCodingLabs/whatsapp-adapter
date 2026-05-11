/**
 * Default fallback salt for {@link hashPhoneNumberId} when neither a
 * call-site salt nor a process-wide override is configured.
 *
 * Production deployments should set a per-environment salt via
 * `WhatsAppClientOptions.redactSalt` (or `WebhookReceiverOptions.redactSalt`)
 * so spans across runs / replicas correlate consistently within an
 * environment but differ across environments.
 */
export const DEFAULT_REDACT_SALT = "@dojocoding/whatsapp-sdk:dev-default-salt";

let processWideSaltOverride: string | undefined;
const encoder = new TextEncoder();

/**
 * Process-wide override for the default salt used by
 * {@link hashPhoneNumberId} when no call-site salt is supplied.
 *
 * @deprecated Prefer the constructor-scoped `redactSalt` option on
 * `WhatsAppClientOptions` and `WebhookReceiverOptions` (added in
 * v0.8.3). The process-wide setter is retained through the 1.x line
 * for backward compatibility and will be removed in v2.0. Multi-tenant
 * deployments must use the constructor option; a single process-wide
 * salt cannot be scoped to a specific WABA-phone pair.
 */
export function setRedactSalt(salt: string): void {
  if (typeof salt !== "string" || salt.length === 0) {
    throw new TypeError("setRedactSalt: salt must be a non-empty string.");
  }
  processWideSaltOverride = salt;
}

/**
 * @internal Reset the process-wide override. Used by tests to keep
 * runs hermetic. Not part of the public surface.
 */
export function _resetRedactSaltForTests(): void {
  processWideSaltOverride = undefined;
}

/**
 * Stable, salted SHA-256 hash truncated to 16 lowercase-hex characters.
 * Suitable for tagging OTel spans without leaking the raw phone number id.
 *
 * Salt resolution precedence:
 *   1. Explicit `salt` argument (per-call / per-client scope).
 *   2. Process-wide override set via `setRedactSalt` (deprecated; v1.x
 *      compatibility shim).
 *   3. {@link DEFAULT_REDACT_SALT}.
 *
 * Runtime-portable: uses `crypto.subtle.digest("SHA-256", ...)` so the
 * function runs unmodified on Node ≥ 20, Cloudflare Workers, Bun, Deno,
 * and any WinterCG runtime.
 */
export async function hashPhoneNumberId(value: string, salt?: string): Promise<string> {
  const effectiveSalt = salt ?? processWideSaltOverride ?? DEFAULT_REDACT_SALT;
  const input = encoder.encode(`${effectiveSalt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const bytes = new Uint8Array(digest);
  // 8 bytes → 16 hex chars; only the prefix is needed.
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}
