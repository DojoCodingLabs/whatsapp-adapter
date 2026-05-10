import { createHash } from "node:crypto";

let redactSalt = "@dojocoding/whatsapp:dev-default-salt";

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
 */
export function hashPhoneNumberId(value: string): string {
  return createHash("sha256")
    .update(redactSalt)
    .update(":")
    .update(value)
    .digest("hex")
    .slice(0, 16);
}
