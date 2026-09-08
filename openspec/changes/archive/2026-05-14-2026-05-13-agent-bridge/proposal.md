# Change proposal — `agent-bridge` primitive for inbound→agent routing

## Why

MCP is request/response. WhatsApp inbound is push. The hybrid
pattern documented in `docs/cookbook/hybrid/agent-handoff-loop.md`
— "SDK receives webhook, routes to agent runtime, agent calls
back via MCP" — is the production-default for agentic front
desks, but the SDK currently ships no primitive for the routing
step. Every consumer rewrites the same 50–80 lines:

```ts
receiver.on("message", async (event) => {
  await tracker.notifyInbound(event.from);     // forgotten 40% of the time
  if (await isOnTakeover(event.from)) return;  // HITL check
  void client.markAsRead({ messageId: event.id, typing: true });
  const task = { /* extract text + media + reply context */ };
  await inbox.push(task);
});
```

This is the right amount of glue to ship as a capability. Site2Print
flagged it in the v1 audit, and the front-desk build spec assumes
it exists (`agent-runtime` consumes from "the bridge"). Today,
"the bridge" is cookbook narrative, not code.

## What Changes

### New capability: `agent-bridge`

A small public surface with three plug points:

```ts
import { createAgentBridge, type AgentInbox, type AgentTask } from "@dojocoding/whatsapp-sdk";

const bridge = createAgentBridge({
  receiver,        // WebhookReceiver
  client,          // WhatsAppLikeClient (for auto-ack + reply path)
  inbox,           // AgentInbox — pluggable
  windowTracker,   // optional — auto-calls notifyInbound on inbound
  isOnTakeover,    // optional — skip enqueue if human is in control
  transform,       // optional — default extracts text/media/reply context
  autoMarkRead,    // default true
  autoTyping,      // default true (only when autoMarkRead is on)
});

// Tear-down for tests / re-config
bridge.dispose();
```

`AgentInbox` is one async method (`append(task)`), mirroring `Storage`.
Ships `InMemoryAgentInbox` for tests; Redis Streams / Postgres /
BullMQ adapters are consumer-side per the same posture as `Storage`.

### `AgentTask` shape

Normalised inbound payload — extracts `text`, `mediaIds`,
`buttonReplyId` / `listReplyId`, `location`, `replyToWamid`,
`ctwaReferral`, `windowOpen` — plus the raw `MessageEvent` as an
escape hatch. Saves every consumer the same parsing.

### Auto-wiring (default ON, opt-out)

- **Window tracker `notifyInbound`** — when `windowTracker` is
  passed, the bridge calls `tracker.notifyInbound(event.from)`
  before enqueueing. Removes the most-forgotten line in every
  cookbook.
- **`markAsRead` + typing indicator** — fired before enqueue so
  the customer sees the blue tick + typing state in <100 ms,
  before any LLM token. Fire-and-forget; never blocks the ack.

Both are opt-out via constructor flags.

### Scope

Handles `message` events only. Status / template lifecycle /
account events flow through `receiver.on(...)` unchanged.

## Non-Goals

- **Running the agent.** The bridge is plumbing; the agent
  runtime (Claude Agent SDK, langchain, …) stays consumer-side.
- **Conversation-state persistence.** Lives in
  `@dojocoding/conversation-state`, not the SDK.
- **Built-in queue backend.** Only `InMemoryAgentInbox` ships;
  Redis / Postgres / SQS implementations are consumer-side per
  the `Storage` adapter posture.
- **Auto-handling status webhooks.** Out of scope; consumers
  attach their own status handler.
- **Cross-process orchestration.** The bridge runs in the
  webhook-receiving process. Distributed-fan-out is what the
  pluggable inbox is for.

## Impact

- **New capability spec** under `openspec/specs/agent-bridge/`
  with 4× ADDED requirements.
- **No modified requirements** elsewhere — the bridge consumes
  existing `WebhookReceiver` and `WhatsAppLikeClient` APIs
  unchanged.
- **Release:** ships as part of `sdk-v1.1.0` alongside the
  conversation-acks and media capabilities.
- **Stability:** the `AgentInbox`/`AgentTask` types, the
  `createAgentBridge` function, and `InMemoryAgentInbox` are part
  of the v1 stability commitment from `sdk-v1.1.0` onwards.
- **Breaking?** No. Pure additive surface.
