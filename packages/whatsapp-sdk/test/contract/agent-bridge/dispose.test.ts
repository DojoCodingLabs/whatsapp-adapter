import { describe, expect, it } from "vitest";

import { createAgentBridge } from "../../../src/agent-bridge/bridge.js";
import { InMemoryAgentInbox } from "../../../src/agent-bridge/in-memory.js";
import { MockWhatsAppClient } from "../../../src/mock/client.js";
import type { MessageEvent } from "../../../src/webhooks/events.js";
import { WebhookReceiver } from "../../../src/webhooks/receiver.js";

const RECEIVER_OPTIONS = { appSecret: "APP-SECRET", verifyToken: "VT" } as const;
const PNID = "PNID";
const WABA = "WABA";

function event(id: string): MessageEvent {
  return {
    kind: "message",
    wabaId: WABA,
    timestamp: 1_700_000_000_000,
    id,
    from: "+5210000000001",
    type: "text",
    body: { text: { body: "x" } },
  };
}

describe("createAgentBridge — dispose semantics", () => {
  it("dispose() detaches the message handler — subsequent events skip the inbox", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const inbox = new InMemoryAgentInbox();

    const bridge = createAgentBridge({ receiver, client, inbox });

    await receiver._dispatchEvents([event("wamid.before")]);
    expect(inbox.tasks).toHaveLength(1);

    bridge.dispose();

    await receiver._dispatchEvents([event("wamid.after")]);
    expect(inbox.tasks).toHaveLength(1);
  });

  it("dispose() is idempotent", () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const bridge = createAgentBridge({
      receiver,
      client,
      inbox: new InMemoryAgentInbox(),
    });

    expect(() => {
      bridge.dispose();
      bridge.dispose();
      bridge.dispose();
    }).not.toThrow();
  });

  it("multiple bridges on one receiver compose; disposing one leaves the other attached", async () => {
    const receiver = new WebhookReceiver(RECEIVER_OPTIONS);
    const client = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    const inboxA = new InMemoryAgentInbox();
    const inboxB = new InMemoryAgentInbox();

    const bridgeA = createAgentBridge({ receiver, client, inbox: inboxA, autoMarkRead: false });
    createAgentBridge({ receiver, client, inbox: inboxB, autoMarkRead: false });

    await receiver._dispatchEvents([event("wamid.shared-1")]);
    expect(inboxA.tasks).toHaveLength(1);
    expect(inboxB.tasks).toHaveLength(1);

    bridgeA.dispose();
    await receiver._dispatchEvents([event("wamid.shared-2")]);
    expect(inboxA.tasks).toHaveLength(1);
    expect(inboxB.tasks).toHaveLength(2);
  });
});
