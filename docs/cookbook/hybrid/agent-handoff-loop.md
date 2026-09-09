# Agent handoff loop — agent sends, customer replies, agent continues

The canonical reason both packages exist. This recipe wires:

1. **Outbound through MCP.** An LLM agent (Claude Desktop, the
   Claude Agent SDK, etc.) initiates a conversation by calling
   `whatsapp_send_template`.
2. **Inbound through the SDK.** Your server runs `WebhookReceiver`
   to parse + verify the customer's reply.
3. **Route the reply back.** Your server hands the reply to the
   agent's runtime so the conversation continues.

The result: the agent feels like a persistent participant in a
multi-turn WhatsApp conversation, even though it's actually a
request/response tool surface.

## Architecture

```
              ┌─────────────────────────────────────────────┐
              │  Your Node process (one per WABA-phone pair) │
              │                                              │
   Meta  ─▶  │  Express endpoint  ─▶  WebhookReceiver       │
   webhook   │                          │                    │
              │                          ▼                    │
              │              createAgentBridge handler:      │
              │                tracker.notifyInbound(from)   │
              │                client.markAsRead(typing=on)  │
              │                inbox.append(AgentTask)       │
              │                          │                    │
              │                          ▼                    │
              │              agent runner reads inbox →       │
              │              calls MCP tools                  │
              │                                              │
              │  ◀────  WhatsAppMcpServer (in-process)       │
              │           │       │       │                  │
              │           ▼       ▼       ▼                  │
              │       send_text  send_template  ...          │
              └─────────────────────┬───────────────────────┘
                                    │
                                    ▼
                              Meta Graph API
```

The agent runtime, the receiver, the bridge, and the MCP server
all share one process. They share the same `WhatsAppClient`
instance and the same `WindowTracker`. For the cross-process
variant where the agent runner is separate, see
[`../sdk/agent-bridge-redis-streams.md`](../sdk/agent-bridge-redis-streams.md).

## Step 1 — single-process scaffold

```ts
// server.ts
import express from "express";
import {
  InMemoryStorage,
  WebhookReceiver,
  WhatsAppClient,
  WindowTracker,
} from "@dojocoding/whatsapp-sdk";
import { createWhatsAppMiddleware } from "@dojocoding/whatsapp-sdk/express";
import { WhatsAppMcpServer } from "@dojocoding/whatsapp-mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const PNID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET!;
const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN!;

// In production, swap InMemoryStorage for createRedisStorage(...)
// or createPostgresStorage(...).
const storage = new InMemoryStorage();

const windowTracker = new WindowTracker({ phoneNumberId: PNID, storage });

const client = new WhatsAppClient({
  phoneNumberId: PNID,
  wabaId: WABA,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: APP_SECRET,
  windowTracker,
});

const receiver = new WebhookReceiver({
  appSecret: APP_SECRET,
  verifyToken: VERIFY,
  storage,
});

const mcpServer = new WhatsAppMcpServer({
  client,
  wabaPhoneNumberId: PNID,
  windowTracker,
});

const [mcpServerEnd, mcpClientEnd] = InMemoryTransport.createLinkedPair();
await mcpServer.connect(mcpServerEnd);
```

The `mcpClientEnd` is what you hand to the agent runtime in step 3.

## Step 2 — wire the inbound webhook with `createAgentBridge`

The canonical wiring uses the `agent-bridge` primitive
(shipped in `sdk-v1.1.0`). It bakes in the four steps every
hybrid consumer used to write by hand: `notifyInbound` on the
window tracker, `markAsRead({ typing: true })` on the inbound
wamid, a HITL-takeover gate, and a normalised `AgentTask` shape
your agent runner can read without re-parsing `MessageEvent`.

```ts
import { createAgentBridge, InMemoryAgentInbox } from "@dojocoding/whatsapp-sdk";

const inbox = new InMemoryAgentInbox();
// In production, swap for a RedisStreamsInbox / BullMQ / SQS /
// Postgres LISTEN inbox. See cookbook/sdk/agent-bridge-redis-streams.md.

createAgentBridge({
  receiver,
  client,
  inbox,
  windowTracker, // auto-fires notifyInbound on every inbound
  // Optional — gate the bot when a human is in control:
  // isOnTakeover: (event) => hitl.isOnTakeover(event.from),
});

const app = express();
app.use("/webhooks/whatsapp", createWhatsAppMiddleware({ receiver }));
app.listen(3000, () => {
  console.error("listening on :3000");
});
```

The bridge handles the customer-facing UX baseline for free:
the recipient sees two blue ticks + a typing indicator within
<100 ms of pressing send, before the agent emits its first
token. See
[`typing-while-thinking.md`](./typing-while-thinking.md) for
the pattern and the carve-outs (voice notes, long thinks,
HITL takeover).

### Without the primitive (the old shape)

If you're on `sdk-v1.0.x` or have a reason to skip the bridge
(custom event-routing logic that the `transform` callback
can't express), the hand-rolled equivalent looks like this:

```ts
receiver.on("message", async (event) => {
  // 1. Refresh the 24h window — most-forgotten line in the codebase
  await windowTracker.notifyInbound(event.from, event.timestamp);

  // 2. (Optional) HITL takeover gate
  if (await hitl.isOnTakeover(event.from)) return;

  // 3. Ack the customer — fire-and-forget, DO NOT await
  void client
    .markAsRead({ messageId: event.id, typing: true })
    .catch((err) => log.warn({ err }, "ack failed"));

  // 4. Route the reply to the agent — see step 3 below
  void handleInbound(event);
});
```

The primitive collapses these four steps into one call and
gives you a typed `AgentTask` instead of the raw
`MessageEvent` to hand the agent.

## Step 3 — consume from the inbox and hand to the agent

The bridge writes a normalised `AgentTask` per inbound. Your
agent runner reads from the inbox; the shape decouples the
agent from Meta's wire format.

Two common patterns. Pick one, or do both.

### Pattern A — append to the agent's conversation

If the agent is a long-running session (Claude Agent SDK with a
persistent conversation), watch the inbox and append each task
to the message queue:

```ts
import { ClaudeSDKClient } from "@anthropic-ai/claude-agent-sdk";
import type { AgentTask } from "@dojocoding/whatsapp-sdk";

const agent = new ClaudeSDKClient({
  systemPrompt: `
    You are a customer support agent. You can send WhatsApp messages via
    the @dojocoding/whatsapp-mcp tools. The 24-hour customer-service window
    rules apply — check whatsapp://window/{phone} or trust the WINDOW_CLOSED
    recovery hint.
  `,
  mcpServers: { whatsapp: { transport: mcpClientEnd } },
});

async function processTask(task: AgentTask): Promise<void> {
  const body = task.text ?? `[${task.type}]`;
  await agent.appendUserMessage(`Customer ${task.from} sent: ${body}`);
}
```

For in-memory inboxes (single-process scaffolds), drive a poll
loop or use a custom inbox that pushes into a Node EventEmitter.
For Redis Streams / BullMQ / SQS inboxes, the agent runner is a
separate process that reads from the queue. See
[`../sdk/agent-bridge-redis-streams.md`](../sdk/agent-bridge-redis-streams.md)
for the canonical cross-process wiring.

The agent reads the message, decides what to do, calls
`whatsapp_send_text` (or `_template`, depending on window
state), and the loop continues.

### Pattern B — one Claude run per task

For high-volume / one-shot use cases (transactional confirmations,
short FAQs), fire a fresh Claude run per task. No persistent
conversation; each customer's message gets its own short Claude
session:

```ts
async function processTask(task: AgentTask): Promise<void> {
  const body = task.text ?? `[${task.type}]`;
  // Pseudocode — adapt to your SDK's one-shot API.
  await agent.runOnce({
    systemPrompt: "Reply concisely to one customer message.",
    userMessage: `Customer ${task.from}: ${body}. Reply via whatsapp_send_text.`,
  });
}
```

This pattern is cheaper (no growing context window) but loses
multi-turn coherence — the agent doesn't remember earlier
messages from the same customer unless you stitch history into
the prompt manually.

### Pattern C — intent classification before the agent

For mixed traffic (some replies need an agent, some are
automated FAQ), classify in a custom `transform` and gate the
enqueue, or branch inside `processTask`:

```ts
async function processTask(task: AgentTask): Promise<void> {
  const intent = await classifyIntent(task);
  if (intent === "agent") {
    await agent.appendUserMessage(`Customer ${task.from}: ${task.text}`);
  } else {
    // Automated reply via the SDK directly — no agent involved.
    await client.sendText({
      to: task.from,
      body: "Hello! Press 1 for support.",
      replyTo: task.wamid,
    });
  }
}
```

Or skip enqueue entirely for known-non-agent intents by
returning `null` from a custom transform on the bridge —
saves the queue write when the answer is rule-based.

The hybrid recipe
[`inbound-routed-to-agent.md`](./inbound-routed-to-agent.md)
expands on this with a concrete intent-classification example.

## Step 4 — kick off the conversation from the agent

In an interactive Claude Desktop chat, you trigger the first
outbound by typing instructions. In an autonomous Agent SDK
runtime, you trigger it from your business logic:

```ts
// Triggered by a cron, a queue event, a button click in your
// dashboard — anywhere "we want to reach out to this customer".
await agent.runOnce({
  systemPrompt: "Send the welcome template.",
  userMessage: `Send the "welcome_v1" template (en_US) to +5210000000001.`,
});
```

The agent calls `whatsapp_send_template`, the customer receives,
the customer replies, your `receiver.on("message")` fires, the
agent's conversation appendage triggers Claude to send the
follow-up. Loop closed.

## Why this requires both packages

Could you do this with just the MCP server? No — the MCP server
doesn't see inbound webhooks. Could you do this with just the
SDK? Yes, but you'd lose the agent — the SDK is a library for
_your code_ to call; the MCP server is the surface that puts
that library in front of an LLM.

The two-package design lets each side stay focused:

- The SDK is a typed wrapper around Meta's Graph API + a
  webhook receiver. No LLM concerns.
- The MCP server is a thin wrapper around the SDK's outbound
  surface, with LLM-tailored schemas and recovery hints. No
  webhook concerns.

They share `Storage` (and therefore `WindowTracker` state) as
the integration point.

## Production checklist

- [ ] Storage backend is Redis or Postgres (not in-memory), so
      window state and dedupe survive restarts.
- [ ] Inbox backend is durable too (e.g. `RedisStreamsInbox`),
      so in-flight tasks survive an agent-runner restart. The
      `InMemoryAgentInbox` is fine for dev / single-process but
      drops everything on crash.
- [ ] Webhook receiver runs behind HTTPS (Meta refuses to deliver
      to HTTP).
- [ ] The `WHATSAPP_VERIFY_TOKEN` env var matches what you
      configured in Meta's webhook setup.
- [ ] `WHATSAPP_APP_SECRET` is set; HMAC verification fires on
      every webhook. Test by tampering with a payload.
- [ ] The agent's system prompt explicitly mentions the
      `WINDOW_CLOSED` recovery path — the model is more reliable
      when the rule is stated, not just inferred from the
      `isError` hint.
- [ ] Observability: wire OpenTelemetry so the receiver's spans
      and the MCP server's tool-call spans live in one trace
      tree. See [`docs/sdk/observability.md`](../../sdk/observability.md).
- [ ] Rate-limit guard: even with the agent, a single phone
      number caps at ~80 sends/sec. Wire the SDK's
      `RateLimitedQueue` if you might spike.

## See also

- [`typing-while-thinking.md`](./typing-while-thinking.md) — the
  UX baseline the bridge bakes in by default.
- [`inbound-routed-to-agent.md`](./inbound-routed-to-agent.md) —
  inbound-first variant with intent classification.
- [`compliance-broadcast.md`](./compliance-broadcast.md) — adding
  a consent-ledger gate on agent-triggered broadcasts.
- [`../sdk/agent-bridge-redis-streams.md`](../sdk/agent-bridge-redis-streams.md)
  — cross-process variant with durable queue + consumer groups.
- [`docs/sdk/agent-bridge.md`](../../sdk/agent-bridge.md) — full
  bridge reference.
- [`docs/sdk/webhooks.md`](../../sdk/webhooks.md) — full webhook
  receiver reference.
- [`docs/mcp/auth.md`](../../mcp/auth.md) — auth + multi-WABA
  patterns.
