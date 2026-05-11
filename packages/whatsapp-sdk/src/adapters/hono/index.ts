/**
 * Hono adapter for `@dojocoding/whatsapp-sdk`.
 *
 * Thin wrapper around the web-standard `createWhatsAppHandler` core,
 * adapted to Hono's `Handler` signature. The web core does all the
 * work; this file just unwraps Hono's `c.req.raw` (which is a
 * Fetch-API `Request`) and returns the `Response` Hono expects.
 *
 * Mount with:
 *
 *   import { Hono } from "hono";
 *   import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
 *   import { whatsappHandler } from "@dojocoding/whatsapp-sdk/hono";
 *
 *   const receiver = new WebhookReceiver({ appSecret, verifyToken });
 *   receiver.on("message", async (e) => { … });
 *
 *   const app = new Hono();
 *   app.all("/webhooks/whatsapp", whatsappHandler(receiver));
 *
 * See `docs/hono.md` for a full Cloudflare Workers + Hono walkthrough.
 */

import type { Handler } from "hono";

import type { WebhookReceiver } from "../../webhooks/receiver.js";
import { type CreateWhatsAppHandlerOptions, createWhatsAppHandler } from "../web/index.js";

/** Alias for the web-core options shape; same fields, same semantics. */
export type WhatsAppHonoHandlerOptions = CreateWhatsAppHandlerOptions;

/**
 * Build a Hono `Handler` that wires Meta's webhook contract to a
 * framework-agnostic {@link WebhookReceiver} via the web-standard
 * core. Mount with `app.all(path, whatsappHandler(receiver))`.
 */
export function whatsappHandler(
  receiver: WebhookReceiver,
  options: WhatsAppHonoHandlerOptions = {}
): Handler {
  const core = createWhatsAppHandler(receiver, options);
  return (c) => core(c.req.raw);
}
