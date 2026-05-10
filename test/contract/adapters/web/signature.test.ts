import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createWhatsAppHandler } from "../../../../src/adapters/web/index.js";
import type { MessageEvent } from "../../../../src/webhooks/events.js";
import { WebhookReceiver } from "../../../../src/webhooks/receiver.js";
import { computeSignature } from "../../../../src/webhooks/signature.js";

const APP_SECRET = "shh";
const VERIFY_TOKEN = "ok";
const FIXTURES = fileURLToPath(new URL("../../../__fixtures__/webhooks/", import.meta.url));

async function signedPost(body: Buffer, secret = APP_SECRET): Promise<Request> {
  const sig = "sha256=" + (await computeSignature(body, secret));
  return new Request("https://example.test/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sig,
    },
    body,
  });
}

describe("web handler / POST signature verification + dispatch", () => {
  it("acks 200 and dispatches on a valid signature", async () => {
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const messageHandler = vi.fn();
    receiver.on("message", messageHandler);
    const fn = createWhatsAppHandler(receiver);

    const raw = await readFile(`${FIXTURES}text-inbound.json`);
    const res = await fn(await signedPost(raw));

    expect(res.status).toBe(200);
    // Handlers run async; give microtasks a tick to resolve.
    await new Promise((r) => setTimeout(r, 5));
    expect(messageHandler).toHaveBeenCalledTimes(1);
    expect((messageHandler.mock.calls[0]?.[0] as MessageEvent).id).toBe("wamid.text-1");
  });

  it("returns 401 on a tampered body and does NOT dispatch", async () => {
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const messageHandler = vi.fn();
    receiver.on("message", messageHandler);
    const fn = createWhatsAppHandler(receiver);

    const raw = await readFile(`${FIXTURES}text-inbound.json`);
    const sig = "sha256=" + (await computeSignature(raw, APP_SECRET));
    const tampered = Buffer.from(raw);
    tampered[10] = (tampered[10]! ^ 0x01) & 0xff;

    const req = new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sig },
      body: tampered,
    });
    const res = await fn(req);
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 5));
    expect(messageHandler).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature header is missing", async () => {
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const fn = createWhatsAppHandler(receiver);
    const raw = await readFile(`${FIXTURES}text-inbound.json`);

    const req = new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    });
    const res = await fn(req);
    expect(res.status).toBe(401);
  });
});
