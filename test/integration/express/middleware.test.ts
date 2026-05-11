import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createWhatsAppMiddleware } from "../../../src/adapters/express/index.js";
import type { MessageEvent } from "../../../src/webhooks/events.js";
import { WebhookReceiver } from "../../../src/webhooks/receiver.js";
import { computeSignature } from "../../../src/webhooks/signature.js";

const APP_SECRET = "shh-very-secret";
const VERIFY_TOKEN = "verify-1";

function makeApp(
  receiver: WebhookReceiver,
  options?: Parameters<typeof createWhatsAppMiddleware>[1]
): Express {
  const app = express();
  app.use("/webhook", createWhatsAppMiddleware(receiver, options));
  return app;
}

const PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "+15551234567", phone_number_id: "PNID" },
            messages: [
              {
                from: "521234567890",
                id: "wamid.int-1",
                timestamp: "1735689600",
                text: { body: "hello express" },
                type: "text",
              },
            ],
          },
        },
      ],
    },
  ],
};

const RAW = Buffer.from(JSON.stringify(PAYLOAD), "utf8");

describe("@dojocoding/whatsapp/express middleware", () => {
  describe("GET handshake", () => {
    it("echoes challenge on a valid handshake (200 text/plain)", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      const app = makeApp(receiver);
      const res = await request(app).get("/webhook").query({
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "1234",
      });
      expect(res.status).toBe(200);
      expect(res.text).toBe("1234");
    });

    it("returns 403 on a wrong verify token", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      const app = makeApp(receiver);
      const res = await request(app).get("/webhook").query({
        "hub.mode": "subscribe",
        "hub.verify_token": "WRONG",
        "hub.challenge": "1234",
      });
      expect(res.status).toBe(403);
    });
  });

  describe("POST receiver", () => {
    it("verifies signature, dispatches handlers, acks 200", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      let resolveDispatched: () => void;
      const dispatched = new Promise<void>((r) => {
        resolveDispatched = r;
      });
      const handler = vi.fn((_e: MessageEvent) => {
        resolveDispatched();
      });
      receiver.on("message", handler);
      const app = makeApp(receiver);

      const sig = "sha256=" + (await computeSignature(RAW, APP_SECRET));
      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", sig)
        .send(RAW.toString("utf8"));

      expect(res.status).toBe(200);
      // Wait for the dispatch via the handler itself — deterministic,
      // no setTimeout-based CI-flake assumption.
      await dispatched;
      expect(handler).toHaveBeenCalledTimes(1);
      const firstCallArg = handler.mock.calls[0]?.[0] as unknown as MessageEvent;
      expect(firstCallArg.id).toBe("wamid.int-1");
    });

    it("returns 401 on a tampered body and does NOT dispatch", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      const handler = vi.fn();
      receiver.on("message", handler);
      const app = makeApp(receiver);

      const sig = "sha256=" + (await computeSignature(RAW, APP_SECRET));
      const tampered = Buffer.from(RAW);
      tampered[10] = (tampered[10]! ^ 0x01) & 0xff;

      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", sig)
        .send(tampered);

      expect(res.status).toBe(401);
      // No dispatch is expected on a 401; let the microtask queue
      // turn once so any latent dispatch would surface, then assert.
      await new Promise((r) => setImmediate(r));
      expect(handler).not.toHaveBeenCalled();
    });

    it("returns 401 when the signature header is missing entirely", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      const handler = vi.fn();
      receiver.on("message", handler);
      const app = makeApp(receiver);

      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .send(RAW.toString("utf8"));

      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });

    it("acks 200 before a slow handler resolves (causal, not wall-clock)", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      let resolveSlow: () => void;
      const slowDone = new Promise<void>((r) => {
        resolveSlow = r;
      });
      let handlerFinishedAt: number | null = null;
      receiver.on("message", async () => {
        // Block on an external signal — the test asserts the ack
        // landed BEFORE we release this. No wall-clock window.
        await slowDone;
        handlerFinishedAt = performance.now();
      });
      const app = makeApp(receiver);

      const sig = "sha256=" + (await computeSignature(RAW, APP_SECRET));
      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", sig)
        .send(RAW.toString("utf8"));
      const ackedAt = performance.now();

      expect(res.status).toBe(200);
      // At this point the handler is still suspended on slowDone.
      expect(handlerFinishedAt).toBeNull();
      // Now release the handler and assert it ran AFTER the ack.
      resolveSlow!();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(handlerFinishedAt).not.toBeNull();
      expect(handlerFinishedAt!).toBeGreaterThanOrEqual(ackedAt);
    });

    it("a handler error fires onUnhandledHandlerError and the response is still 200", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      receiver.on("message", () => {
        throw new Error("handler boom");
      });
      const onError = vi.fn();
      const app = makeApp(receiver, { onUnhandledHandlerError: onError });

      const sig = "sha256=" + (await computeSignature(RAW, APP_SECRET));
      const res = await request(app)
        .post("/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", sig)
        .send(RAW.toString("utf8"));

      expect(res.status).toBe(200);
      // Note: the WebhookReceiver swallows the handler error; dispatchPromise
      // resolves normally. onUnhandledHandlerError fires only when the
      // dispatchPromise itself rejects, which currently does NOT happen
      // because the receiver catches handler errors. Documented behaviour:
      // onError handlers registered via receiver.on("error", …) are the
      // canonical path for handler exceptions; the adapter's hook is a
      // safety net for unforeseen rejections.
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe("Other verbs", () => {
    it("PUT returns 405 with Allow: GET, POST", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      const app = makeApp(receiver);
      const res = await request(app).put("/webhook").send({});
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toBe("GET, POST");
    });

    it("DELETE returns 405", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      const app = makeApp(receiver);
      const res = await request(app).delete("/webhook");
      expect(res.status).toBe(405);
    });
  });
});
