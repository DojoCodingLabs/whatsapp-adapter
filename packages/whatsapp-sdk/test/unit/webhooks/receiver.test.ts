import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { InMemoryStorage } from "../../../src/storage/index.js";
import type { MessageEvent, StatusEvent, WhatsAppEvent } from "../../../src/webhooks/events.js";
import { WebhookReceiver } from "../../../src/webhooks/receiver.js";
import { computeSignature } from "../../../src/webhooks/signature.js";

const APP_SECRET = "test-secret";
const VERIFY_TOKEN = "verify-token-1";
const FIXTURES = fileURLToPath(new URL("../../__fixtures__/webhooks/", import.meta.url));

async function loadRaw(name: string): Promise<{ raw: Buffer; parsed: unknown; sig: string }> {
  const raw = await readFile(`${FIXTURES}${name}.json`);
  const parsed = JSON.parse(raw.toString("utf8")) as unknown;
  const sig = "sha256=" + (await computeSignature(raw, APP_SECRET));
  return { raw, parsed, sig };
}

describe("WebhookReceiver.handleVerifyRequest", () => {
  it("echoes the challenge on a valid handshake", () => {
    const r = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    expect(
      r.handleVerifyRequest({ mode: "subscribe", verifyToken: VERIFY_TOKEN, challenge: "abc" })
    ).toEqual({ status: 200, body: "abc" });
  });

  it("returns 403 on a wrong verify token", () => {
    const r = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    expect(
      r.handleVerifyRequest({ mode: "subscribe", verifyToken: "WRONG", challenge: "abc" })
    ).toEqual({ status: 403 });
  });
});

describe("WebhookReceiver.handlePayload", () => {
  it("returns 401 on a bad signature and invokes no handlers", async () => {
    const r = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const handler = vi.fn();
    r.on("message", handler);
    const { raw, parsed } = await loadRaw("text-inbound");
    const result = await r.handlePayload(raw, "sha256=BAD", parsed);
    expect(result.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("dispatches a parsed message to a registered handler", async () => {
    const r = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const handler = vi.fn();
    r.on("message", handler);
    const { raw, parsed, sig } = await loadRaw("text-inbound");
    const result = await r.handlePayload(raw, sig, parsed);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      await result.dispatchPromise;
    }
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0]?.[0] as MessageEvent).id).toBe("wamid.text-1");
  });

  it("dedupes: handler called only once across two duplicate deliveries", async () => {
    const r = new WebhookReceiver({
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
      storage: new InMemoryStorage(),
    });
    const handler = vi.fn();
    r.on("message", handler);
    const { raw, parsed, sig } = await loadRaw("text-inbound");
    const a = await r.handlePayload(raw, sig, parsed);
    const b = await r.handlePayload(raw, sig, parsed);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    if (a.status === 200) await a.dispatchPromise;
    if (b.status === 200) await b.dispatchPromise;
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does NOT collapse status transitions on the same wamid", async () => {
    const r = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const handler = vi.fn();
    r.on("status", handler);
    const sent = await loadRaw("status-sent");
    const failed = await loadRaw("status-failed");
    const a = await r.handlePayload(sent.raw, sent.sig, sent.parsed);
    const b = await r.handlePayload(failed.raw, failed.sig, failed.parsed);
    if (a.status === 200) await a.dispatchPromise;
    if (b.status === 200) await b.dispatchPromise;
    expect(handler).toHaveBeenCalledTimes(2);
    const calls = handler.mock.calls.map((c) => (c[0] as StatusEvent).status);
    expect(calls).toEqual(["sent", "failed"]);
  });

  it("handler errors fire the `error` event without breaking other handlers", async () => {
    const r = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const ok = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const errH = vi.fn();
    r.on("message", bad);
    r.on("message", ok);
    r.on("error", errH);
    const { raw, parsed, sig } = await loadRaw("text-inbound");
    const result = await r.handlePayload(raw, sig, parsed);
    if (result.status === 200) await result.dispatchPromise;
    expect(bad).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(errH).toHaveBeenCalledTimes(1);
    const call = errH.mock.calls[0] as unknown as [unknown, MessageEvent];
    expect((call[0] as Error).message).toBe("boom");
    expect(call[1].id).toBe("wamid.text-1");
  });

  it("invokes onError constructor hook on handler exception", async () => {
    const onError = vi.fn();
    const r = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, onError });
    r.on("message", () => {
      throw new Error("nope");
    });
    const { raw, parsed, sig } = await loadRaw("text-inbound");
    const result = await r.handlePayload(raw, sig, parsed);
    if (result.status === 200) await result.dispatchPromise;
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("off() unregisters a handler", async () => {
    const r = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const handler = vi.fn();
    r.on("message", handler);
    r.off("message", handler);
    const { raw, parsed, sig } = await loadRaw("text-inbound");
    const result = await r.handlePayload(raw, sig, parsed);
    if (result.status === 200) await result.dispatchPromise;
    expect(handler).not.toHaveBeenCalled();
  });

  it("_dispatchEvents lets mock-mode synthesize without a signature", async () => {
    const r = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const handler = vi.fn();
    r.on("template_status", handler);
    const synthetic: WhatsAppEvent = {
      kind: "template_status",
      wabaId: "WABA",
      timestamp: 0,
      templateId: "tpl",
      event: "APPROVED",
    };
    await r._dispatchEvents([synthetic]);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
