// createWhatsAppHandler: a correctly signed body that is not JSON is
// a 400 (previously 200 with zero events); unsigned stays 401.
import { describe, expect, it, vi } from "vitest";

import { createWhatsAppHandler } from "../../../../src/adapters/web/index.js";
import { WebhookReceiver } from "../../../../src/webhooks/receiver.js";
import { computeSignature } from "../../../../src/webhooks/signature.js";

const APP_SECRET = "shh";

async function post(body: string, signed: boolean): Promise<Request> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signed)
    headers["x-hub-signature-256"] = "sha256=" + (await computeSignature(body, APP_SECRET));
  return new Request("https://example.test/webhook", { method: "POST", headers, body });
}

describe("web handler / POST non-JSON body", () => {
  it("returns 400 for a signed non-JSON or empty body and dispatches nothing", async () => {
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: "ok" });
    const onError = vi.fn();
    receiver.on("error", onError);
    const waitUntil = vi.fn();
    const fn = createWhatsAppHandler(receiver, { waitUntil });
    for (const body of ["not json", "{", ""]) {
      expect((await fn(await post(body, true))).status, JSON.stringify(body)).toBe(400);
    }
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("returns 401 for an unsigned non-JSON body", async () => {
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: "ok" });
    const fn = createWhatsAppHandler(receiver);
    expect((await fn(await post("not json", false))).status).toBe(401);
  });

  it("still returns 200 for signed JSON that carries no events", async () => {
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: "ok" });
    const fn = createWhatsAppHandler(receiver);
    expect(
      (await fn(await post('{"object":"whatsapp_business_account","entry":[]}', true))).status
    ).toBe(200);
  });
});
