import { describe, expect, it } from "vitest";

import { createWhatsAppHandler } from "../../../../src/adapters/web/index.js";
import { WebhookReceiver } from "../../../../src/webhooks/receiver.js";

const APP_SECRET = "shh";
const VERIFY_TOKEN = "ok";

function handler() {
  const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
  return { receiver, fn: createWhatsAppHandler(receiver) };
}

describe("web handler / GET handshake", () => {
  it("echoes the challenge on a valid handshake (200 text/plain)", async () => {
    const { fn } = handler();
    const req = new Request(
      "https://example.test/webhook?hub.mode=subscribe&hub.verify_token=ok&hub.challenge=1234"
    );
    const res = await fn(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("1234");
  });

  it("returns 403 on a wrong verify token", async () => {
    const { fn } = handler();
    const req = new Request(
      "https://example.test/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234"
    );
    const res = await fn(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when mode is not subscribe", async () => {
    const { fn } = handler();
    const req = new Request(
      "https://example.test/webhook?hub.mode=unsubscribe&hub.verify_token=ok&hub.challenge=1234"
    );
    const res = await fn(req);
    expect(res.status).toBe(403);
  });
});
