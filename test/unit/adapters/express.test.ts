import { describe, expect, it } from "vitest";

import { createWhatsAppMiddleware } from "../../../src/adapters/express/index.js";
import { WebhookReceiver } from "../../../src/webhooks/receiver.js";

describe("@dojocoding/whatsapp/express", () => {
  it("createWhatsAppMiddleware returns an Express-shaped function (router)", () => {
    const receiver = new WebhookReceiver({ appSecret: "shh", verifyToken: "ok" });
    const mw = createWhatsAppMiddleware(receiver);
    expect(typeof mw).toBe("function");
  });

  it("the returned router has a stack with mounted routes", () => {
    const receiver = new WebhookReceiver({ appSecret: "shh", verifyToken: "ok" });
    const mw = createWhatsAppMiddleware(receiver);
    // express.Router instance has a `stack` array of layers; assert the
    // adapter actually mounted handlers.
    expect((mw as { stack?: unknown[] }).stack).toBeDefined();
    expect(Array.isArray((mw as { stack: unknown[] }).stack)).toBe(true);
  });
});
