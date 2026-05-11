import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { whatsappHandler } from "../../../src/adapters/hono/index.js";
import type { MessageEvent } from "../../../src/webhooks/events.js";
import { WebhookReceiver } from "../../../src/webhooks/receiver.js";
import { computeSignature } from "../../../src/webhooks/signature.js";

const APP_SECRET = "shh";
const VERIFY_TOKEN = "ok";
const FIXTURES = fileURLToPath(new URL("../../__fixtures__/webhooks/", import.meta.url));

function buildApp(receiver: WebhookReceiver) {
  const app = new Hono();
  app.all("/webhook", whatsappHandler(receiver));
  return app;
}

describe("@dojocoding/whatsapp/hono adapter", () => {
  describe("GET handshake", () => {
    it("echoes the challenge on a valid handshake", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      const app = buildApp(receiver);
      const res = await app.request(
        "/webhook?hub.mode=subscribe&hub.verify_token=ok&hub.challenge=42"
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(await res.text()).toBe("42");
    });

    it("returns 403 on a wrong verify token", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      const app = buildApp(receiver);
      const res = await app.request(
        "/webhook?hub.mode=subscribe&hub.verify_token=NOPE&hub.challenge=42"
      );
      expect(res.status).toBe(403);
    });
  });

  describe("POST receiver", () => {
    it("verifies signature, dispatches handler, acks 200", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      let resolveDispatched: () => void;
      const dispatched = new Promise<void>((r) => {
        resolveDispatched = r;
      });
      const handler = vi.fn((_e: MessageEvent) => {
        resolveDispatched();
      });
      receiver.on("message", handler);
      const app = buildApp(receiver);

      const raw = await readFile(`${FIXTURES}text-inbound.json`);
      const sig = "sha256=" + (await computeSignature(raw, APP_SECRET));
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": sig },
        body: raw,
      });

      expect(res.status).toBe(200);
      await dispatched;
      expect(handler).toHaveBeenCalledTimes(1);
      const firstCallArg = handler.mock.calls[0]?.[0] as unknown as MessageEvent;
      expect(firstCallArg.id).toBe("wamid.text-1");
    });

    it("returns 401 on a tampered body and does NOT dispatch", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      const handler = vi.fn();
      receiver.on("message", handler);
      const app = buildApp(receiver);

      const raw = await readFile(`${FIXTURES}text-inbound.json`);
      const sig = "sha256=" + (await computeSignature(raw, APP_SECRET));
      const tampered = Buffer.from(raw);
      tampered[10] = (tampered[10]! ^ 0x01) & 0xff;

      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": sig },
        body: tampered,
      });

      expect(res.status).toBe(401);
      await new Promise((r) => setImmediate(r));
      expect(handler).not.toHaveBeenCalled();
    });

    it("returns 401 when the signature header is missing", async () => {
      const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
      const app = buildApp(receiver);
      const raw = await readFile(`${FIXTURES}text-inbound.json`);

      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw,
      });
      expect(res.status).toBe(401);
    });
  });

  describe("method routing", () => {
    for (const method of ["PUT", "DELETE", "PATCH"]) {
      it(`returns 405 on ${method}`, async () => {
        const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
        const app = buildApp(receiver);
        const res = await app.request("/webhook", { method });
        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("GET, POST");
      });
    }
  });
});
