/**
 * Express adapter for `@dojocoding/whatsapp`.
 *
 * Phase 8 will land the real implementation: a middleware factory that
 *   1. mounts both GET handshake + POST receiver on one path,
 *   2. captures raw body bytes BEFORE any body-parser sees them,
 *   3. timing-safe HMAC-SHA256 verifies, and
 *   4. acks 200 within {@link WEBHOOK_ACK_DEADLINE_MS} while running handlers async.
 *
 * Phase 0 wires the subpath through `package.json` `exports` so the package
 * shape is stable from day 0; importing this entry today throws.
 */
export function createWhatsAppMiddleware(): never {
  throw new Error(
    "@dojocoding/whatsapp/express is not implemented yet — see Phase 8 of the OpenSpec roadmap."
  );
}
