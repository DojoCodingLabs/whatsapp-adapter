/**
 * Express adapter for `@dojocoding/whatsapp-sdk`.
 *
 * Thin shim over `@dojocoding/whatsapp-sdk/web`: every request is buffered
 * into a `Uint8Array`, converted to a Fetch-API `Request`, handed to
 * `createWhatsAppHandler`, and the resulting `Response` is written
 * back onto Express's `res`. All behaviour (handshake, signature,
 * dispatch, 30 s ack, 405 routing) lives in the web core; this file
 * just translates Express's req/res calling convention.
 *
 * Mount with:
 *
 *   import express from "express";
 *   import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
 *   import { createWhatsAppMiddleware } from "@dojocoding/whatsapp-sdk/express";
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
 */

import { Buffer } from "node:buffer";

import express, { type Router } from "express";

import type { WebhookReceiver } from "../../webhooks/receiver.js";
import { type CreateWhatsAppHandlerOptions, createWhatsAppHandler } from "../web/index.js";

export type CreateWhatsAppMiddlewareOptions = CreateWhatsAppHandlerOptions;

/**
 * Build an Express `Router` that wires Meta's webhook contract to a
 * framework-agnostic {@link WebhookReceiver}. Delegates to the
 * web-standard core (`createWhatsAppHandler`) — this is a translation
 * layer, not its own implementation.
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
  const handler = createWhatsAppHandler(receiver, { onUnhandledHandlerError });

  router.get("/", (req, res) => {
    const url = `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`;
    const headers = headersFromExpress(req);
    handler(new Request(url, { method: "GET", headers })).then(
      (r) => writeResponseToExpress(r, res),
      (err: unknown) => {
        onUnhandledHandlerError(err);
        res.status(500).end();
      }
    );
  });

  router.post("/", express.raw({ type: "application/json" }), (req, res) => {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const url = `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`;
    const headers = headersFromExpress(req);
    // Buffer is a Uint8Array subclass; no copy.
    handler(new Request(url, { method: "POST", headers, body: new Uint8Array(rawBody) })).then(
      (r) => writeResponseToExpress(r, res),
      (err: unknown) => {
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

function headersFromExpress(req: express.Request): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else if (typeof v === "string") {
      headers.set(k, v);
    }
  }
  return headers;
}

async function writeResponseToExpress(r: Response, res: express.Response): Promise<void> {
  res.status(r.status);
  r.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const text = await r.text();
  if (text.length === 0) {
    res.end();
    return;
  }
  res.send(text);
}
