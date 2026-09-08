import { describe, expect, it, vi } from "vitest";

import { createAgentBridge } from "../../../src/agent-bridge/bridge.js";
import { InMemoryAgentInbox } from "../../../src/agent-bridge/in-memory.js";
import type { AgentInbox, AgentTask } from "../../../src/agent-bridge/types.js";
import { MockWhatsAppClient } from "../../../src/mock/client.js";
import { InMemoryStorage } from "../../../src/storage/index.js";
import type { MessageEvent, StatusEvent } from "../../../src/webhooks/events.js";
import { WebhookReceiver } from "../../../src/webhooks/receiver.js";
import { WindowTracker } from "../../../src/window/tracker.js";

const RECEIVER_OPTIONS = {
  appSecret: "APP-SECRET",
  verifyToken: "VT",
} as const;

const PNID = "PNID";
const WABA = "WABA";
const TO = "+5210000000001";

function textEvent(overrides: Partial<MessageEvent> = {}): MessageEvent {
  return {
    kind: "message",
    wabaId: WABA,
    timestamp: 1_700_000_000_000,
    id: "wamid.A",
    from: TO,
    type: "text",
    body: { text: { body: "hola" } },
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  // Two ticks: one for the await chain inside the handler, one for
  // the fire-and-forget markAsRead promise to settle. Both run on
  // the microtask queue so resolving once is usually enough; we do
  // two to be safe against test flakiness.
  await Promise.resolve();
  await Promise.resolve();
}

describe("createAgentBridge — dispatch contract", () => {
  it("end-to-end: inbound message → AgentTask on the inbox", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const inbox = new InMemoryAgentInbox();

    createAgentBridge({ receiver, client, inbox });

    await receiver._dispatchEvents([textEvent()]);

    expect(inbox.tasks).toHaveLength(1);
    expect(inbox.tasks[0]?.from).toBe(TO);
    expect(inbox.tasks[0]?.text).toBe("hola");
  });

  it("auto-fires notifyInbound on the windowTracker BEFORE the task is built", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const inbox = new InMemoryAgentInbox();
    const tracker = new WindowTracker({ phoneNumberId: PNID, storage: new InMemoryStorage() });

    expect(await tracker.isWindowOpen(TO)).toBe(false);

    createAgentBridge({ receiver, client, inbox, windowTracker: tracker });

    await receiver._dispatchEvents([textEvent()]);

    expect(await tracker.isWindowOpen(TO)).toBe(true);
    expect(inbox.tasks[0]?.windowOpen).toBe(true);
  });

  it("auto-fires markAsRead with typing=true by default", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const inbox = new InMemoryAgentInbox();

    createAgentBridge({ receiver, client, inbox });

    await receiver._dispatchEvents([textEvent({ id: "wamid.acked" })]);
    await flushMicrotasks();

    expect(client.markReads).toHaveLength(1);
    expect(client.markReads[0]).toMatchObject({
      messageId: "wamid.acked",
      typing: true,
    });
  });

  it("autoTyping: false suppresses the typing indicator but still acks", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const inbox = new InMemoryAgentInbox();

    createAgentBridge({ receiver, client, inbox, autoTyping: false });

    await receiver._dispatchEvents([textEvent({ id: "wamid.acked" })]);
    await flushMicrotasks();

    expect(client.markReads).toHaveLength(1);
    expect(client.markReads[0]?.typing).toBe(false);
  });

  it("autoMarkRead: false suppresses the ack entirely", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const inbox = new InMemoryAgentInbox();

    createAgentBridge({ receiver, client, inbox, autoMarkRead: false });

    await receiver._dispatchEvents([textEvent()]);
    await flushMicrotasks();

    expect(client.markReads).toHaveLength(0);
    expect(inbox.tasks).toHaveLength(1);
  });

  it("isOnTakeover returning true skips both ack and enqueue", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const inbox = new InMemoryAgentInbox();

    createAgentBridge({
      receiver,
      client,
      inbox,
      isOnTakeover: (event) => event.from === TO,
    });

    await receiver._dispatchEvents([textEvent()]);
    await flushMicrotasks();

    expect(inbox.tasks).toHaveLength(0);
    expect(client.markReads).toHaveLength(0);
  });

  it("transform returning null skips enqueue but still acks", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const inbox = new InMemoryAgentInbox();

    createAgentBridge({ receiver, client, inbox, transform: () => null });

    await receiver._dispatchEvents([textEvent()]);
    await flushMicrotasks();

    expect(inbox.tasks).toHaveLength(0);
    expect(client.markReads).toHaveLength(1);
  });

  it("custom transform can reshape the task", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const inbox = new InMemoryAgentInbox();

    createAgentBridge({
      receiver,
      client,
      inbox,
      transform: (event): AgentTask => ({
        receivedAt: event.timestamp,
        conversationId: `tenant-A::${event.from}`,
        from: event.from,
        wamid: event.id,
        type: event.type,
        raw: event,
      }),
    });

    await receiver._dispatchEvents([textEvent()]);

    expect(inbox.tasks[0]?.conversationId).toBe(`tenant-A::${TO}`);
  });

  it("inbox.append rejection routes through onError and does NOT crash the dispatch", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const onError = vi.fn();

    let calls = 0;
    const flakyInbox: AgentInbox = {
      append: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error("queue full")) : Promise.resolve();
      },
    };

    createAgentBridge({ receiver, client, inbox: flakyInbox, onError });

    await receiver._dispatchEvents([textEvent({ id: "wamid.first" })]);
    await flushMicrotasks();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe("queue full");

    // A subsequent dispatch still flows through — bridge is not
    // permanently broken by one failed append.
    await receiver._dispatchEvents([textEvent({ id: "wamid.second" })]);
    expect(calls).toBe(2);
  });

  it("markAsRead failure routes through onError but never blocks enqueue", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    // Override the mock's markAsRead so it rejects, without replacing
    // the whole instance. The bridge's auto-ack uses fire-and-forget
    // semantics — the rejection must NOT block the enqueue path.
    client.markAsRead = vi
      .fn<typeof client.markAsRead>()
      .mockRejectedValue(new Error("ack failed"));
    const inbox = new InMemoryAgentInbox();
    const onError = vi.fn();

    createAgentBridge({ receiver, client, inbox, onError });

    await receiver._dispatchEvents([textEvent()]);
    await flushMicrotasks();

    expect(inbox.tasks).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("status events are NOT enqueued — bridge only attends to inbound messages", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const inbox = new InMemoryAgentInbox();

    createAgentBridge({ receiver, client, inbox });

    const statusEvent: StatusEvent = {
      kind: "status",
      wabaId: WABA,
      timestamp: 1_700_000_000_000,
      id: "wamid.outbound",
      status: "delivered",
    };
    await receiver._dispatchEvents([statusEvent]);

    expect(inbox.tasks).toHaveLength(0);
  });
});
