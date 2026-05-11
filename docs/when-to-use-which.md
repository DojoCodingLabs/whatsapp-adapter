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
