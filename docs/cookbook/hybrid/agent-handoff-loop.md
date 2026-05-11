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
              │              tracker.notifyInbound(from)      │
              │              event → agent.appendUserMessage  │
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

The agent runtime, the receiver, and the MCP server all share
one process. They share the same `WhatsAppClient` instance and
the same `WindowTracker`.

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

## Step 2 — wire the inbound webhook + tracker

```ts
const app = express();

app.use("/webhooks/whatsapp", createWhatsAppMiddleware({ receiver }));

receiver.on("message", async (event) => {
  // Open the 24-hour window for this recipient (so subsequent
  // agent-driven free-form sends work).
  await windowTracker.notifyInbound(event.from);

  // Route the reply to the agent — see step 3.
  void handleInbound(event);
});

app.listen(3000, () => {
  console.error("listening on :3000");
});
```

The `notifyInbound` call is the bit that makes the
`whatsapp://window/{phone}` resource useful — every time a
customer messages in, the tracker records it, and the MCP
server's resource starts returning `isOpen: true` for that
phone.

## Step 3 — route inbound to the agent

Two common patterns. Pick one, or do both.

### Pattern A — append to the agent's conversation

If the agent is a long-running session (Claude Agent SDK with a
persistent conversation), append the inbound to the message
queue:

```ts
import { ClaudeSDKClient } from "@anthropic-ai/claude-agent-sdk";

const agent = new ClaudeSDKClient({
  systemPrompt: `
    You are a customer support agent. You can send WhatsApp messages via
    the @dojocoding/whatsapp-mcp tools. The 24-hour customer-service window
    rules apply — check whatsapp://window/{phone} or trust the WINDOW_CLOSED
    recovery hint.
  `,
  mcpServers: { whatsapp: { transport: mcpClientEnd } },
});

async function handleInbound(
  event: import("@dojocoding/whatsapp-sdk").MessageInboundEvent
): Promise<void> {
  const body = event.message.type === "text" ? event.message.text : `[${event.message.type}]`;
  await agent.appendUserMessage(
    `Customer ${event.from} (${event.profileName ?? "unknown"}) sent: ${body}`
  );
}
```

The agent reads the message, decides what to do, calls
`whatsapp_send_text` (or `_template`, depending on window
state), and the loop continues.

### Pattern B — one Claude run per inbound

For high-volume / one-shot use cases (transactional confirmations,
short FAQs), fire a fresh Claude run per inbound. No persistent
conversation; each customer's message gets its own short Claude
session:

```ts
async function handleInbound(
  event: import("@dojocoding/whatsapp-sdk").MessageInboundEvent
): Promise<void> {
  const body = event.message.type === "text" ? event.message.text : `[${event.message.type}]`;

  // Pseudocode — adapt to your SDK's one-shot API.
  await agent.runOnce({
    systemPrompt: "Reply concisely to one customer message.",
    userMessage: `Customer ${event.from}: ${body}. Reply via whatsapp_send_text.`,
  });
}
```

This pattern is cheaper (no growing context window) but loses
multi-turn coherence — the agent doesn't remember earlier
messages from the same customer unless you stitch history into
the prompt manually.

### Pattern C — agent decides whether to engage

For mixed traffic (some replies need an agent, some are
automated FAQ), classify first:

```ts
receiver.on("message", async (event) => {
  await windowTracker.notifyInbound(event.from);

  const intent = await classifyIntent(event); // your call
  if (intent === "agent") {
    await handleInbound(event);
  } else {
    // Automated reply via the SDK directly — no agent involved.
    await client.sendText({ to: event.from, body: "Hello! Press 1 for support." });
  }
});
```

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

- [`inbound-routed-to-agent.md`](./inbound-routed-to-agent.md) —
  inbound-first variant with intent classification.
- [`compliance-broadcast.md`](./compliance-broadcast.md) — adding
  a consent-ledger gate on agent-triggered broadcasts.
- [`docs/sdk/webhooks.md`](../../sdk/webhooks.md) — full webhook
  receiver reference.
- [`docs/mcp/auth.md`](../../mcp/auth.md) — auth + multi-WABA
  patterns.
