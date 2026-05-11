# When to use which?

This repository ships two coordinated packages. They are designed
to be **used together** in production, but each has a clear
solo lane. Pick the path that matches what you're building.

## The decision tree

```
What are you building?
├── A server that processes WhatsApp webhooks
│   (a customer support back-end, multi-tenant API, queue
│   worker, your business-logic backbone)
│   └─→ @dojocoding/whatsapp-sdk
│
├── An LLM agent that sends WhatsApp messages
│   (Claude Desktop slash command, Claude Agent SDK runtime,
│   Cursor / Cline tool surface)
│   └─→ @dojocoding/whatsapp-mcp
│
└── Both
    (the production-default: agent triggers outbound, server
    receives inbound, server routes inbound back to agent)
    └─→ @dojocoding/whatsapp-sdk + @dojocoding/whatsapp-mcp
        └─→ See docs/cookbook/hybrid/ for the patterns
```

## The longer story

### Pure SDK — server-side, no agent involvement

Choose `@dojocoding/whatsapp-sdk` alone when:

- You are running a long-lived process (Node service, Cloudflare
  Worker, Bun, Deno) that handles inbound WhatsApp webhooks.
- Your outbound sends are triggered by **your code**, not by an
  LLM — buttons in a dashboard, cron-scheduled drip campaigns,
  transactional notifications fired from internal events.
- You need fine-grained control: rate-limited queues, idempotency
  keys, multi-WABA fan-out, OpenTelemetry spans, custom
  observability redaction.

Quickstart: [`docs/sdk/quickstart.md`](./sdk/quickstart.md). Cookbook
patterns: [`docs/cookbook/sdk/`](./cookbook/sdk/).

### Pure MCP — agent-only, no server-side webhook surface

Choose `@dojocoding/whatsapp-mcp` alone when:

- You want an **LLM agent** (Claude Desktop, Cline, Cursor, the
  Claude Agent SDK) to be able to send WhatsApp messages on demand.
- You don't need to react to inbound messages programmatically —
  either you're using WhatsApp for one-way notifications, or
  you handle replies via the Meta Business Manager UI / a separate
  tool.
- You want zero infrastructure: `npx -y @dojocoding/whatsapp-mcp`
  - 4 lines of `claude_desktop_config.json` and you're done.

Quickstart: [`docs/mcp/quickstart.md`](./mcp/quickstart.md). Cookbook
patterns: [`docs/cookbook/mcp/`](./cookbook/mcp/).

### Both — the production-default

This is where the two-package architecture earns its keep. The
canonical pattern:

1. **Outbound via MCP.** The agent (Claude Desktop, an Agent SDK
   process, whatever) calls `whatsapp_send_template` to start a
   conversation. Templates are window-exempt — they work even
   when the 24-hour customer-service window is closed.
2. **Inbound via SDK.** Your server runs `WebhookReceiver` to
   parse and verify the incoming webhook from Meta. The
   `message` event handler captures the customer's reply.
3. **Hand the reply back to the agent.** Your server pings the
   agent runtime (or appends to a queue the agent reads from)
   so the conversation continues.

This is the production-default because pure-MCP servers can't
receive webhooks (MCP is request/response from the client's
perspective; there's no native push channel), and pure-SDK
servers don't expose their surface to agents.

The full cookbook for this is [`docs/cookbook/hybrid/agent-handoff-loop.md`](./cookbook/hybrid/agent-handoff-loop.md).
Two other useful hybrid patterns:

- [`docs/cookbook/hybrid/inbound-routed-to-agent.md`](./cookbook/hybrid/inbound-routed-to-agent.md) —
  inbound-first variant: the SDK receives a customer message,
  an intent classifier routes to an MCP-driven agent for
  follow-up.
- [`docs/cookbook/hybrid/compliance-broadcast.md`](./cookbook/hybrid/compliance-broadcast.md) —
  marketing team triggers a template broadcast through the
  agent, server-side middleware validates against a consent
  ledger before the send fires.

## Per-call decision inside the orchestrator

Once you've picked **"both"** above, you have one process with
both packages loaded. The next question is: for any given
outbound send, do I go through the SDK or through the MCP
server?

**One-line rule:**

> Use the SDK when **your code** is calling WhatsApp.
> Use the MCP server when **an LLM** is calling WhatsApp.

Same `WhatsAppClient` instance underneath either way — the MCP
server's tool handlers call `client.sendText` (etc.) just like
your business code does. The split is about _who initiated the
call_, not about parallel infrastructure.

### Decision tree

```
Who decides what to send?
│
├─ Your code, deterministically
│  (cron, webhook reply, state-change trigger, business rule)
│  → SDK — call client.sendX directly, bypass the MCP layer
│
├─ An LLM, based on context and judgment
│  (drafting a response, picking a template, deciding when
│   to escalate, choosing copy)
│  → MCP — the agent calls whatsapp_send_* tools
│
└─ Hybrid: LLM drafts, human approves, code sends
   → MCP for the draft tool, SDK for the actual send
```

Two more questions sharpen it:

| Question                                                                    | If yes →                                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Am I **receiving** an inbound message?                                      | SDK (`WebhookReceiver`). The MCP server has no inbound surface by design.    |
| Am I sending the same fixed payload every time?                             | SDK — no LLM value-add.                                                      |
| Does recipient / content / timing depend on what the LLM read from context? | MCP — the recovery hints (`WINDOW_CLOSED` → "use template") earn their keep. |
| Am I outside the agent's loop (cron worker, queue handler, HITL inbox UI)?  | SDK — your code, not an LLM.                                                 |
| Is the operator in Claude Desktop wanting to send a one-off template?       | MCP — they're using the `/wa-template-send` prompt.                          |

### Three caller paths into one client

In production-default orchestrator processes, **three caller
paths converge on a single `WhatsAppClient` instance:**

```
                        ┌───────────────────────────────────┐
                        │  WhatsAppClient (one per process) │
                        └─────┬─────────────────────────────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
   ┌───┴─────┐         ┌──────┴──────┐         ┌─────┴─────────┐
   │ Your    │         │ MCP server  │         │ HITL inbox UI │
   │ code    │         │ (embedded)  │         │ API routes    │
   │         │         │             │         │               │
   │ • cron  │         │ • agent     │         │ • operator    │
   │   sends │         │   tools     │         │   types       │
   │ • CRM   │         │ • recovery  │         │   manual      │
   │   event │         │   hints     │         │   reply       │
   │ • web-  │         │ • prompts   │         │ • takeover    │
   │   hook  │         │ • drift     │         │   toggle      │
   │   reply │         │   detector  │         │               │
   └─────────┘         └─────────────┘         └───────────────┘
```

All three sends flow through the same client → same window
tracker → same dedupe → same OTel spans → same rate-limit
queue. **You don't run separate WhatsApp infrastructure for the
agent's sends and the human's sends.**

### Concrete examples

**Pure SDK** — a Tour Plan booking confirms; your code dispatches
a brief PDF to the guide:

```ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";

async function dispatchBrief(wa: WhatsAppClient, booking: Booking) {
  await wa.sendDocument({
    to: booking.guidePhone,
    link: briefPdfUrl,
    filename: `${booking.id}-brief.pdf`,
    caption: `Brief para ${booking.guestName} mañana a las ${booking.pickupTime}`,
  });
}
```

No LLM judgment about whether or what to send. SDK.

**Pure MCP** — a lead messages WhatsApp; the agent drafts the
reply:

```ts
// Inbound from the SDK
receiver.on("message", async (event) => {
  await agent.appendUserMessage(`
    New lead from ${event.from}. Their message:
    ${event.message.text}

    Draft a response in the right language + voice and send via
    whatsapp_send_text. If they're asking about availability,
    check the calendar MCP first.
  `);
});
```

The agent then calls `whatsapp_send_text` itself. MCP.

**Hybrid** — HITL operator path: an operator opens the inbox UI
and types their own reply. No LLM in the loop at send time:

```ts
// HITL inbox API route
app.post("/api/conversations/:id/send", async (req, res) => {
  await waClient.sendText({ to: conv.externalId, body: req.body.body });
  res.sendStatus(200);
});
```

That's pure SDK. The _same_ operator, on Claude Desktop, types
`/wa-template-send` to compose a templated send — that's pure
MCP. Both paths funnel into the same `waClient` instance.

For the full process scaffold see
[`cookbook/hybrid/orchestrator-process-layout.md`](./cookbook/hybrid/orchestrator-process-layout.md).

### Cross-cutting policy goes between MCP and SDK

If you need to gate the agent's sends with cross-cutting policy
(consent ledger, audit log, per-tenant rate limit, A/B routing),
wrap the `WhatsAppClient` in a class that implements
`WhatsAppLikeClient` and hand the wrapper to
`WhatsAppMcpServer({ client: wrapper, ... })`. The agent sees the
same MCP tool surface; the wrapper intercepts before reaching
the real client. Your business code that _bypasses_ MCP (cron,
HITL UI) calls the real client directly and skips the policy
gate by design.

See [`cookbook/hybrid/compliance-broadcast.md`](./cookbook/hybrid/compliance-broadcast.md)
for the consent-gating instance of this pattern; the same shape
generalises to any cross-cutting concern.

## What about Storage?

Both packages share the SDK's `Storage` interface (in-memory,
Redis, Postgres). In the hybrid pattern, the SDK's
`WindowTracker` lives in the server (populated by inbound
webhooks). The MCP server can read from the same `WindowTracker`
via the `whatsapp://window/{phone}` resource if you embed
`WhatsAppMcpServer` in-process — that's the Claude Agent SDK
pattern. For the spawn-via-`npx` Claude Desktop case, the MCP
server runs in its own process and the window resource returns
`isOpen: false` until the same machine's server populates a
shared Redis / Postgres backend that both processes read.

See [`docs/sdk/storage.md`](./sdk/storage.md) for the storage
backends.

## Two more questions

**"Can I run the MCP server on a remote host?"** Not in v1.
The stdio transport is what Claude Desktop / Cursor / Cline
expect. A Streamable HTTP transport for hosted MCP servers is a
v2 candidate; see [`docs/mcp/transports.md`](./mcp/transports.md).

**"Can the MCP server receive webhooks?"** Not in v1, and
probably not ever — that's not what the MCP protocol is for.
Webhooks are inbound, push-based, and require a public HTTP
endpoint. MCP servers are stdio child processes the host spawns.
Wire inbound via the SDK's `WebhookReceiver` in your own server
and use the hybrid cookbook recipes to route replies back into
the agent.
