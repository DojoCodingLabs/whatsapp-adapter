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
  it("returns 200 before a slow handler settles (does not await dispatch)", async () => {
    // Deterministic version of the old wall-clock check (<80 ms), which
    // flaked under coverage on loaded CI hosts. The handler blocks until
    // the test releases it, so the response can only arrive if the
    // adapter acked without awaiting the dispatch promise.
    let release!: () => void;
    let settled = false;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    receiver.on("message", async () => {
      await blocked;
      settled = true;
    });
    const fn = createWhatsAppHandler(receiver);

    const raw = await readFile(`${FIXTURES}text-inbound.json`);
    const sig = "sha256=" + (await computeSignature(raw, APP_SECRET));
    const req = new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sig },
      body: raw,
    });

    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5_000));
    const res = await Promise.race([fn(req), timeout]);

    expect(res).not.toBe("timeout");
    expect((res as Response).status).toBe(200);
    expect(settled).toBe(false);
    release();
  });
});
