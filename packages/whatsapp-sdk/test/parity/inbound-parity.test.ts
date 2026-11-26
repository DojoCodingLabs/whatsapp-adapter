import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { MockWhatsAppClient } from "../../src/mock/client.js";
import type { MessageEvent } from "../../src/webhooks/events.js";
import { parseWebhookPayload } from "../../src/webhooks/parser.js";
import { WebhookReceiver } from "../../src/webhooks/receiver.js";
import { computeSignature } from "../../src/webhooks/signature.js";

const FIXTURES = fileURLToPath(new URL("../__fixtures__/webhooks/", import.meta.url));

const APP_SECRET = "shh";
const VERIFY_TOKEN = "ok";

describe("parity: inbound dispatch", () => {
  it("simulateInbound triggers the same handler as a captured-fixture handlePayload", async () => {
    const realRaw = await readFile(`${FIXTURES}text-inbound.json`);
    const realParsed = JSON.parse(realRaw.toString("utf8")) as unknown;
    const sig = "sha256=" + (await computeSignature(realRaw, APP_SECRET));
    const expectedFromFixture = parseWebhookPayload(realParsed)[0] as MessageEvent;

    // Receiver A driven by the real handlePayload pipeline.
    const a = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const aHandler = vi.fn();
    a.on("message", aHandler);
    const result = await a.handlePayload(realRaw, sig, realParsed);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      await result.dispatchPromise;
    }

    // Receiver B driven by simulateInbound on the same parsed event.
    const b = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const bHandler = vi.fn();
    b.on("message", bHandler);
    const mock = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    await mock.simulateInbound(b, expectedFromFixture);

    // Both handlers received the SAME event shape.
    expect(aHandler).toHaveBeenCalledTimes(1);
    expect(bHandler).toHaveBeenCalledTimes(1);
    expect(aHandler.mock.calls[0]?.[0]).toEqual(bHandler.mock.calls[0]?.[0]);
  });

  it.each([
    "bsuid-username-text",
    "bsuid-parent-text",
    "ctwa-referral-doc",
    "audio-voice",
    "interactive-product",
    "system-user-changed-user-id",
  ])("simulateInbound carries the BSUID / contact fields identically (%s)", async (fixture) => {
    const raw = await readFile(`${FIXTURES}${fixture}.json`);
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    const sig = "sha256=" + (await computeSignature(raw, APP_SECRET));
    const fromFixture = parseWebhookPayload(parsed)[0] as MessageEvent;

    const a = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const aHandler = vi.fn();
    a.on("message", aHandler);
    const result = await a.handlePayload(raw, sig, parsed);
    if (result.status === 200) await result.dispatchPromise;

    const b = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const bHandler = vi.fn();
    b.on("message", bHandler);
    const mock = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    await mock.simulateInbound(b, fromFixture);

    const got = aHandler.mock.calls[0]?.[0] as MessageEvent;
    expect(got).toEqual(bHandler.mock.calls[0]?.[0]);
    expect(got.fromUserId).toBe("US.13491208655302741918");
    expect(got.fromUserId).toBe(fromFixture.fromUserId);
    expect(got.contact).toEqual(fromFixture.contact);
  });
});
