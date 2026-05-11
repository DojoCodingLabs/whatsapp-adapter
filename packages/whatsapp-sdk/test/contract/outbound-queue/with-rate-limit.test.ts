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
