/**
 * Express adapter for `@dojocoding/whatsapp`.
 *
 * Mount with:
 *
 *   import express from "express";
 *   import { WebhookReceiver } from "@dojocoding/whatsapp";
 *   import { createWhatsAppMiddleware } from "@dojocoding/whatsapp/express";
 *
 *   const receiver = new WebhookReceiver({ appSecret, verifyToken });
 *   receiver.on("message", async (e) => { … });
 *
 *   const app = express();
 *   app.use("/webhooks/whatsapp", createWhatsAppMiddleware(receiver));
 *   //  ^ register BEFORE any global express.json() — the middleware
 *   //    captures the raw body locally, but a global json() registered
 *   //    earlier will consume the stream and the HMAC will fail to
 *   //    verify (you'll see 401s).
 *
 * Behaviour:
 *   - GET → verify-token handshake, echoes `hub.challenge` on success
 *           (200 text/plain) or returns 403.
 *   - POST → raw-body HMAC verify, parsed-payload dispatch via the
 *            receiver. Acks 200 BEFORE awaiting handlers (Meta's 30 s
 *            rule), then runs handlers asynchronously.
 *   - Other verbs → 405 Method Not Allowed.
 */

import { Buffer } from "node:buffer";

import express, { type Router } from "express";

import type { WebhookReceiver } from "../../webhooks/receiver.js";

export interface CreateWhatsAppMiddlewareOptions {
  /** Invoked when a handler thrown error escapes dispatchPromise. Defaults to console.error. */
  onUnhandledHandlerError?: (err: unknown) => void;
}

/**
 * Build an Express `Router` that wires Meta's webhook contract to a
 * framework-agnostic {@link WebhookReceiver}.
 */
export function createWhatsAppMiddleware(
  receiver: WebhookReceiver,
  options: CreateWhatsAppMiddlewareOptions = {}
): Router {
  const router = express.Router();
  const onUnhandledHandlerError =
    options.onUnhandledHandlerError ??
    ((err: unknown): void => {
      console.error("[whatsapp/express] unhandled handler error:", err);
    });

  router.get("/", (req, res) => {
    const result = receiver.handleVerifyRequest({
      mode: req.query["hub.mode"] as string | undefined,
      verifyToken: req.query["hub.verify_token"] as string | undefined,
      challenge: req.query["hub.challenge"] as string | undefined,
    });
    if (result.status === 200) {
      res.status(200).type("text/plain").send(result.body);
      return;
    }
    res.status(403).end();
  });

  router.post("/", express.raw({ type: "application/json" }), (req, res) => {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const sigHeader =
      req.header("x-hub-signature-256") ?? req.header("X-Hub-Signature-256") ?? null;
    let parsed: unknown = undefined;
    if (rawBody.length > 0) {
      try {
        parsed = JSON.parse(rawBody.toString("utf8"));
      } catch {
        // Leave as undefined; the receiver tolerates a non-object.
        parsed = undefined;
      }
    }
    receiver.handlePayload(rawBody, sigHeader, parsed).then(
      (result) => {
        if (result.status === 200) {
          res.status(200).end();
          // Run handlers async — the response is already sent, so a slow
          // handler does not delay Meta's 30 s ack.
          result.dispatchPromise.catch(onUnhandledHandlerError);
          return;
        }
        res.status(401).end();
      },
      (err: unknown) => {
        // handlePayload itself failing (e.g. WebCrypto unavailable) is
        // an internal error; surface it without delaying the ack
        // contract — Meta will retry on a 5xx.
        onUnhandledHandlerError(err);
        res.status(500).end();
      }
    );
  });

  router.all("/", (_req, res) => {
    res.set("Allow", "GET, POST").status(405).end();
  });

  return router;
}
