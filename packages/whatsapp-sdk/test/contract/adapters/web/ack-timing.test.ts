import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createWhatsAppHandler } from "../../../../src/adapters/web/index.js";
import { WebhookReceiver } from "../../../../src/webhooks/receiver.js";
import { computeSignature } from "../../../../src/webhooks/signature.js";

const APP_SECRET = "shh";
const VERIFY_TOKEN = "ok";
const FIXTURES = fileURLToPath(new URL("../../../__fixtures__/webhooks/", import.meta.url));

describe("web handler / ack timing", () => {
  it("returns 200 within ~20 ms even when a handler takes 100 ms", async () => {
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    receiver.on("message", () => new Promise<void>((r) => setTimeout(r, 100)));
    const fn = createWhatsAppHandler(receiver);

    const raw = await readFile(`${FIXTURES}text-inbound.json`);
    const sig = "sha256=" + (await computeSignature(raw, APP_SECRET));
    const req = new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sig },
      body: raw,
    });

    const start = Date.now();
    const res = await fn(req);
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    // 100 ms handler must NOT have been awaited; ack should be well below.
    expect(elapsed).toBeLessThan(80);
  });
});
