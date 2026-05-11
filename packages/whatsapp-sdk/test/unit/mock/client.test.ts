import { describe, expect, it, vi } from "vitest";

import { MockWhatsAppClient } from "../../../src/mock/client.js";
import { InMemoryStorage } from "../../../src/storage/index.js";
import { TemplateError, WindowClosedError } from "../../../src/types/errors.js";
import type { MessageEvent } from "../../../src/webhooks/events.js";
import { WebhookReceiver } from "../../../src/webhooks/receiver.js";
import { WindowTracker } from "../../../src/window/tracker.js";

const TO = "521234567890";

const PNID = "PNID-mock";
const WABA = "WABA-mock";

describe("MockWhatsAppClient", () => {
  it("constructs without credentials", () => {
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    expect(m.phoneNumberId).toBe(PNID);
    expect(m.wabaId).toBe(WABA);
  });

  it("sendText returns wamid.mock-1 and records the payload", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const out = await m.sendText({ to: TO, body: "hi" });
    expect(out.messages[0]?.id).toBe("wamid.mock-1");
    expect(m.sentMessages).toHaveLength(1);
    expect(m.sentMessages[0]?.payload.type).toBe("text");
    expect((m.sentMessages[0]?.payload as { text: { body: string } }).text.body).toBe("hi");
  });

  it("does NOT call globalThis.fetch on send", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = () => {
      calls += 1;
      return Promise.reject(new Error("network not allowed in mock"));
    };
    try {
      const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
      await m.sendText({ to: TO, body: "hi" });
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });

  it("sequential wamids increment per send", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const a = await m.sendText({ to: TO, body: "1" });
    const b = await m.sendText({ to: TO, body: "2" });
    expect(a.messages[0]?.id).toBe("wamid.mock-1");
    expect(b.messages[0]?.id).toBe("wamid.mock-2");
  });

  it("reset() clears sentMessages and the counter", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    await m.sendText({ to: TO, body: "1" });
    await m.sendText({ to: TO, body: "2" });
    m.reset();
    expect(m.sentMessages).toHaveLength(0);
    const next = await m.sendText({ to: TO, body: "fresh" });
    expect(next.messages[0]?.id).toBe("wamid.mock-1");
  });

  it("sendTemplate is recorded and is window-exempt", async () => {
    const tracker = new WindowTracker({ phoneNumberId: PNID, storage: new InMemoryStorage() });
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA, windowTracker: tracker });
    // Window is closed (no notifyInbound)
    await expect(m.sendText({ to: TO, body: "x" })).rejects.toBeInstanceOf(WindowClosedError);
    // Template still goes through
    const out = await m.sendTemplate({ to: TO, name: "hello_world", language: "en_US" });
    expect(out.messages[0]?.id).toBe("wamid.mock-1");
    expect(m.sentMessages).toHaveLength(1);
  });

  it("free-form sends are gated by the configured tracker", async () => {
    const tracker = new WindowTracker({ phoneNumberId: PNID, storage: new InMemoryStorage() });
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA, windowTracker: tracker });
    await expect(m.sendImage({ to: TO, link: "https://x" })).rejects.toBeInstanceOf(
      WindowClosedError
    );
    await tracker.notifyInbound(TO);
    const out = await m.sendImage({ to: TO, link: "https://x" });
    expect(out.messages[0]?.id).toBeDefined();
  });

  it("simulateInbound dispatches synthetic events to a receiver", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const receiver = new WebhookReceiver({
      appSecret: "shh",
      verifyToken: "ok",
    });
    const handler = vi.fn();
    receiver.on("message", handler);
    const synthetic: MessageEvent = {
      kind: "message",
      wabaId: WABA,
      timestamp: 0,
      id: "wamid.synthetic-1",
      from: TO,
      type: "text",
      body: { type: "text", text: { body: "hi from mock" } },
    };
    await m.simulateInbound(receiver, synthetic);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0]?.[0] as MessageEvent).id).toBe("wamid.synthetic-1");
  });

  it("listTemplates returns an empty list", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const out = await m.listTemplates();
    expect(out.data).toEqual([]);
  });

  it("getTemplate rejects with TemplateError (no registry in v1)", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    await expect(m.getTemplate("TPL")).rejects.toBeInstanceOf(TemplateError);
  });

  it("getTemplate rejects empty id with TypeError", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    await expect(m.getTemplate("")).rejects.toBeInstanceOf(TypeError);
  });

  it("isWindowOpen returns true when no tracker is configured", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    expect(await m.isWindowOpen(TO)).toBe(true);
  });

  it("sendReply attaches context.message_id and is window-gated for free-form", async () => {
    const tracker = new WindowTracker({ phoneNumberId: PNID, storage: new InMemoryStorage() });
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA, windowTracker: tracker });
    await expect(
      m.sendReply("wamid.parent", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: TO,
        type: "text",
        text: { body: "ack" },
      })
    ).rejects.toBeInstanceOf(WindowClosedError);

    await tracker.notifyInbound(TO);
    const ok = await m.sendReply("wamid.parent", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: TO,
      type: "text",
      text: { body: "ack" },
    });
    expect(ok.messages[0]?.id).toBeDefined();
    expect(m.sentMessages.at(-1)?.payload.context).toEqual({ message_id: "wamid.parent" });
  });

  it("rejects empty replyTo synchronously", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    await expect(
      m.sendReply("", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: TO,
        type: "text",
        text: { body: "x" },
      })
    ).rejects.toThrow();
  });
});
