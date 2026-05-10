/**
 * Web-standard (Fetch-API) adapter for `@dojocoding/whatsapp`.
 *
 * Returns a function with shape `(req: Request) => Promise<Response>` —
 * mountable as a Cloudflare Workers `fetch` handler, a Hono / Next.js
 * App Router route handler, a Bun `Bun.serve` handler, or anywhere
 * else that speaks the Fetch API.
 *
 * The Express adapter (`@dojocoding/whatsapp/express`) is a thin shim
 * over this same core; see `docs/web.md` for runtime examples.
 *
 * Behaviour:
 *   - GET → verify-token handshake via `receiver.handleVerifyRequest`.
 *           200 text/plain with the challenge body on success, 403 on
 *           mismatch.
 *   - POST → raw bytes via `req.arrayBuffer()` (read exactly once),
 *           passed verbatim to `receiver.handlePayload`. Acks 200
 *           BEFORE awaiting handlers (Meta's 30 s rule), then runs
 *           handlers asynchronously.
 *   - Other verbs → 405 Method Not Allowed.
 */

import type { WebhookReceiver } from "../../webhooks/receiver.js";

export interface CreateWhatsAppHandlerOptions {
  /**
   * Invoked when a handler thrown error escapes the dispatch promise.
   * Defaults to `console.error`.
   */
  onUnhandledHandlerError?: (err: unknown) => void;
}

export type WhatsAppHandler = (req: Request) => Promise<Response>;

/**
 * Build a Fetch-API handler wiring Meta's webhook contract to a
 * framework-agnostic {@link WebhookReceiver}.
 */
export function createWhatsAppHandler(
  receiver: WebhookReceiver,
  options: CreateWhatsAppHandlerOptions = {}
): WhatsAppHandler {
  const onUnhandledHandlerError =
    options.onUnhandledHandlerError ??
    ((err: unknown): void => {
      console.error("[whatsapp/web] unhandled handler error:", err);
    });

  return async (req: Request): Promise<Response> => {
    const method = req.method.toUpperCase();

    if (method === "GET") {
      const url = new URL(req.url);
      const mode = url.searchParams.get("hub.mode") ?? undefined;
      const verifyToken = url.searchParams.get("hub.verify_token") ?? undefined;
      const challenge = url.searchParams.get("hub.challenge") ?? undefined;
      const result = receiver.handleVerifyRequest({ mode, verifyToken, challenge });
      if (result.status === 200) {
        return new Response(result.body, {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(null, { status: 403 });
    }

    if (method === "POST") {
      // Read raw bytes ONCE. These exact bytes are fed to the HMAC
      // verifier; JSON parsing happens on a separate decode below.
      const rawBody = new Uint8Array(await req.arrayBuffer());
      const sigHeader = req.headers.get("x-hub-signature-256");
      let parsed: unknown = undefined;
      if (rawBody.length > 0) {
        try {
          parsed = JSON.parse(new TextDecoder("utf-8").decode(rawBody));
        } catch {
          parsed = undefined;
        }
      }
      const result = await receiver.handlePayload(rawBody, sigHeader, parsed);
      if (result.status === 200) {
        // Run handlers async — the Response is returned below; a slow
        // handler does not delay Meta's 30 s ack.
        result.dispatchPromise.catch(onUnhandledHandlerError);
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 401 });
    }

    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  };
}
