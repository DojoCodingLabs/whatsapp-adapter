import { describe, expect, it } from "vitest";

import { InMemoryAgentInbox } from "../../../src/agent-bridge/in-memory.js";
import type { AgentTask } from "../../../src/agent-bridge/types.js";
import type { MessageEvent } from "../../../src/webhooks/events.js";

function buildTask(wamid: string): AgentTask {
  const raw: MessageEvent = {
    kind: "message",
    wabaId: "WABA",
    timestamp: 0,
    id: wamid,
    from: "+5210000000001",
    type: "text",
    body: { text: { body: "x" } },
  };
  return {
    receivedAt: 0,
    conversationId: raw.from,
    from: raw.from,
    wamid,
    type: "text",
    raw,
  };
}

describe("InMemoryAgentInbox", () => {
  it("starts empty", () => {
    const inbox = new InMemoryAgentInbox();
    expect(inbox.tasks).toEqual([]);
  });

  it("records each appended task in arrival order", async () => {
    const inbox = new InMemoryAgentInbox();
    await inbox.append(buildTask("wamid.A"));
    await inbox.append(buildTask("wamid.B"));
    expect(inbox.tasks.map((t) => t.wamid)).toEqual(["wamid.A", "wamid.B"]);
  });

  it("reset() clears recorded tasks", async () => {
    const inbox = new InMemoryAgentInbox();
    await inbox.append(buildTask("wamid.X"));
    expect(inbox.tasks).toHaveLength(1);
    inbox.reset();
    expect(inbox.tasks).toEqual([]);
  });
});
