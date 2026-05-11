import { describe, expect, it, vi } from "vitest";

import { MockWhatsAppClient } from "../../../src/mock/client.js";
import { withRateLimit } from "../../../src/queue/with-rate-limit.js";

const MOCK_OPTIONS = { phoneNumberId: "PNID", wabaId: "WABA" } as const;

describe("withRateLimit contract", () => {
  it("delegates send* through to the wrapped client with same surface", async () => {
    const mock = new MockWhatsAppClient(MOCK_OPTIONS);
    const wrapped = withRateLimit(mock, { perPair: { messages: 1_000, per: 1_000 } });
    await wrapped.sendText({ to: "+5210000000001", body: "hi" });
    expect(mock.sentMessages).toHaveLength(1);
    expect(mock.sentMessages[0]!.payload.to).toBe("+5210000000001");
  });

  it("preserves readonly properties", () => {
    const mock = new MockWhatsAppClient(MOCK_OPTIONS);
    const wrapped = withRateLimit(mock);
    expect(wrapped.phoneNumberId).toBe("PNID");
    expect(wrapped.wabaId).toBe("WABA");
    expect(wrapped.graphApiVersion).toBe(mock.graphApiVersion);
  });

  it("per-pair: second send to same recipient within 6 s waits", async () => {
    const mock = new MockWhatsAppClient(MOCK_OPTIONS);
    const wrapped = withRateLimit(mock, {
      perPair: { messages: 1, per: 300 },
      perWaba: { mps: 1_000 },
    });
    const to = "+5210000000001";
    const start = performance.now();
    await wrapped.sendText({ to, body: "first" });
    await wrapped.sendText({ to, body: "second" });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThan(280);
    expect(elapsed).toBeLessThan(600);
    expect(mock.sentMessages).toHaveLength(2);
  });

  it("per-pair: distinct recipients do NOT contend", async () => {
    const mock = new MockWhatsAppClient(MOCK_OPTIONS);
    const wrapped = withRateLimit(mock, {
      perPair: { messages: 1, per: 5_000 },
      perWaba: { mps: 1_000 },
    });
    const start = performance.now();
    await Promise.all([
      wrapped.sendText({ to: "+5210000000001", body: "a" }),
      wrapped.sendText({ to: "+5210000000002", body: "b" }),
      wrapped.sendText({ to: "+5210000000003", body: "c" }),
    ]);
    expect(performance.now() - start).toBeLessThan(100);
    expect(mock.sentMessages).toHaveLength(3);
  });

  it("per-WABA: 20 distinct recipients at 50 MPS take ~ (N-1)/50 s", async () => {
    const mock = new MockWhatsAppClient(MOCK_OPTIONS);
    const wrapped = withRateLimit(mock, {
      perPair: { messages: 1_000, per: 1_000 },
      perWaba: { mps: 50 },
    });
    const sends = Array.from({ length: 20 }, (_, i) =>
      wrapped.sendText({ to: `+52100000${String(i).padStart(5, "0")}`, body: "x" })
    );
    const start = performance.now();
    await Promise.all(sends);
    const elapsed = performance.now() - start;
    // First N tokens are free (bucket starts full at capacity=50 = 1*50).
    // 20 sends fit within the initial capacity, so should complete fast.
    expect(elapsed).toBeLessThan(150);
    expect(mock.sentMessages).toHaveLength(20);
  });

  it("per-WABA: when fanout exceeds capacity, throughput respects MPS ceiling", async () => {
    const mock = new MockWhatsAppClient(MOCK_OPTIONS);
    // Capacity = mps = 10, refill = 10/sec, so token n+10 lands at n*100ms.
    const wrapped = withRateLimit(mock, {
      perPair: { messages: 1_000, per: 1_000 },
      perWaba: { mps: 10 },
    });
    const sends = Array.from({ length: 15 }, (_, i) =>
      wrapped.sendText({ to: `+52100000${String(i).padStart(5, "0")}`, body: "x" })
    );
    const start = performance.now();
    await Promise.all(sends);
    const elapsed = performance.now() - start;
    // 10 fit in the initial bucket; 5 more need (5/10) = 500ms of refill.
    expect(elapsed).toBeGreaterThan(400);
    expect(elapsed).toBeLessThan(900);
  });

  it("non-send methods pass through without queueing", async () => {
    const mock = new MockWhatsAppClient(MOCK_OPTIONS);
    const isOpen = vi.spyOn(mock, "isWindowOpen");
    const list = vi.spyOn(mock, "listTemplates");
    const wrapped = withRateLimit(mock, { perPair: { messages: 1, per: 100_000 } });
    // Pre-drain a pair so any accidental queueing would block.
    await wrapped.sendText({ to: "+1", body: "x" });
    const start = performance.now();
    await wrapped.isWindowOpen("+52100");
    await wrapped.listTemplates();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(isOpen).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("two decorator instances are independent", async () => {
    const mock = new MockWhatsAppClient(MOCK_OPTIONS);
    const a = withRateLimit(mock, { perPair: { messages: 1, per: 5_000 } });
    const b = withRateLimit(mock, { perPair: { messages: 1, per: 5_000 } });
    await a.sendText({ to: "+1", body: "from a" });
    // Drained on `a`; on `b` the bucket is fresh.
    const start = performance.now();
    await b.sendText({ to: "+1", body: "from b" });
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("delegates the full send surface through the gate (every wrapped send method)", async () => {
    // Every send branch of the decorator must (a) await gate(input.to)
    // and (b) forward to the wrapped client. Single test exercises
    // all the previously-uncovered branches: sendInteractive,
    // sendTemplate, sendAuthTemplate, sendVoice, sendCarouselTemplate,
    // sendReaction. sendReply has its own test below; sendText is
    // exercised by every other test.
    const mock = new MockWhatsAppClient(MOCK_OPTIONS);
    const wrapped = withRateLimit(mock, { perPair: { messages: 1_000, per: 1_000 } });
    const TO = "+5210000000001";

    await wrapped.sendImage({ to: TO, link: "https://example.com/a.jpg" });
    await wrapped.sendVideo({ to: TO, link: "https://example.com/v.mp4" });
    await wrapped.sendAudio({ to: TO, link: "https://example.com/a.mp3" });
    await wrapped.sendDocument({
      to: TO,
      link: "https://example.com/d.pdf",
      filename: "d.pdf",
    });
    await wrapped.sendSticker({ to: TO, link: "https://example.com/s.webp" });
    await wrapped.sendLocation({ to: TO, latitude: 0, longitude: 0 });
    await wrapped.sendContacts({
      to: TO,
      contacts: [{ name: { formatted_name: "Alice" } }],
    });
    await wrapped.sendInteractive({
      kind: "button",
      to: TO,
      body: "Pick",
      buttons: [{ id: "yes", title: "Yes" }],
    });
    await wrapped.sendTemplate({ to: TO, name: "hello_world", language: "en_US" });
    await wrapped.sendAuthTemplate({ to: TO, name: "otp", language: "en_US", otp: "123456" });
    await wrapped.sendVoice({ to: TO, link: "https://example.com/v.ogg" });
    await wrapped.sendCarouselTemplate({
      to: TO,
      name: "summer_sale",
      language: "en_US",
      cards: [{ header: { type: "image", link: "https://example.com/c.jpg" } }],
    });
    await wrapped.sendReaction({ to: TO, messageId: "wamid.parent", emoji: "❤️" });

    expect(mock.sentMessages).toHaveLength(13);
    const types = mock.sentMessages.map((m) => m.payload.type);
    expect(types).toEqual([
      "image",
      "video",
      "audio",
      "document",
      "sticker",
      "location",
      "contacts",
      "interactive",
      "template", // sendTemplate
      "template", // sendAuthTemplate (template type with auth components)
      "audio", // sendVoice (audio with voice:true flag)
      "template", // sendCarouselTemplate
      "reaction",
    ]);
    // sendText is exercised by every other test; sendReply has its
    // own dedicated test (per-pair-key behaviour).
  });

  it("per-pair gate applies uniformly across send method types (voice gates the next text)", async () => {
    // Proves the `gate(input.to)` call inside the sendVoice branch
    // actually consumes from the per-pair token bucket — a regression
    // would skip the gate and let the second send fire immediately.
    const mock = new MockWhatsAppClient(MOCK_OPTIONS);
    const wrapped = withRateLimit(mock, {
      perPair: { messages: 1, per: 300 },
      perWaba: { mps: 1_000 },
    });
    const TO = "+5210000000001";
    const start = performance.now();
    await wrapped.sendVoice({ to: TO, link: "https://example.com/v.ogg" });
    await wrapped.sendText({ to: TO, body: "after voice" });
    expect(performance.now() - start).toBeGreaterThan(280);
  });

  it("sendReply uses payload.to for the pair key (not replyTo)", async () => {
    const mock = new MockWhatsAppClient(MOCK_OPTIONS);
    const wrapped = withRateLimit(mock, {
      perPair: { messages: 1, per: 300 },
      perWaba: { mps: 1_000 },
    });
    // First send to "+1" drains the per-pair bucket for "+1".
    await wrapped.sendText({ to: "+1", body: "x" });
    // sendReply with payload.to = "+2" should NOT wait, because the
    // per-pair bucket for "+2" is fresh.
    const start = performance.now();
    await wrapped.sendReply("wamid.xyz", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+2",
      type: "text",
      text: { body: "reply" },
    });
    expect(performance.now() - start).toBeLessThan(50);
  });
});
