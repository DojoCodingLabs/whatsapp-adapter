# Docs

Documentation for `@dojocoding/whatsapp-sdk` and `@dojocoding/whatsapp-mcp`.

## Start here

→ **[`when-to-use-which.md`](./when-to-use-which.md)** — decision
tree. Read this first if you're unsure which package fits your use
case.

## Three entry points

### "I'm building a server that handles WhatsApp webhooks"

You want the SDK. Start at [`sdk/quickstart.md`](./sdk/quickstart.md).

Patterns: [`cookbook/sdk/`](./cookbook/sdk/) (inbound auto-responder,
two-way support with handoff, transactional notifications,
appointment booking, multi-tenant, Cloudflare Workers, Hono).

### "I'm wiring an LLM agent to send WhatsApp messages"

You want the MCP server. Start at [`mcp/quickstart.md`](./mcp/quickstart.md).

Patterns: [`cookbook/mcp/`](./cookbook/mcp/) (Claude Desktop setup,
Claude Agent SDK embedding, multi-server config for multi-WABA).

### "I'm doing both — agent-driven outbound + server-side inbound"

You want both packages. Start at
[`cookbook/hybrid/agent-handoff-loop.md`](./cookbook/hybrid/agent-handoff-loop.md)
— the canonical agent ↔ customer ↔ server ↔ agent loop.

## Reference

### Cross-cutting (applies to both packages)

- [`architecture.md`](./architecture.md) — system view; how the SDK
  and MCP server fit together; where state lives
- [`compliance.md`](./compliance.md) — WhatsApp Business Messaging
  policy, what the SDK enforces, what the consumer is responsible
  for
- [`compatibility.md`](./compatibility.md) — Node / Bun / Deno /
  Cloudflare Workers runtime support

### SDK reference ([`sdk/`](./sdk/))

| Topic                                        | Doc                                              |
| -------------------------------------------- | ------------------------------------------------ |
| Quickstart                                   | [`sdk/quickstart.md`](./sdk/quickstart.md)       |
| `WhatsAppClient` (outbound)                  | [`sdk/client.md`](./sdk/client.md)               |
| Webhook receiver                             | [`sdk/webhooks.md`](./sdk/webhooks.md)           |
| 24-hour window enforcement                   | [`sdk/window.md`](./sdk/window.md)               |
| Message builders                             | [`sdk/messages.md`](./sdk/messages.md)           |
| Template management                          | [`sdk/templates.md`](./sdk/templates.md)         |
| Storage backends (in-mem / Redis / Postgres) | [`sdk/storage.md`](./sdk/storage.md)             |
| Rate-limited outbound queue                  | [`sdk/queue.md`](./sdk/queue.md)                 |
| Mock mode                                    | [`sdk/mock.md`](./sdk/mock.md)                   |
| Observability (OTel)                         | [`sdk/observability.md`](./sdk/observability.md) |
| Express adapter                              | [`sdk/express.md`](./sdk/express.md)             |
| Web-standard adapter (Workers / Bun / Deno)  | [`sdk/web.md`](./sdk/web.md)                     |
| Hono adapter                                 | [`sdk/hono.md`](./sdk/hono.md)                   |
| Patterns                                     | [`sdk/patterns.md`](./sdk/patterns.md)           |

### MCP reference ([`mcp/`](./mcp/))

| Topic                                                       | Doc                                                |
| ----------------------------------------------------------- | -------------------------------------------------- |
| Claude Desktop quickstart                                   | [`mcp/quickstart.md`](./mcp/quickstart.md)         |
| All 16 tools                                                | [`mcp/tools.md`](./mcp/tools.md)                   |
| Resources (`whatsapp://window/...`, `whatsapp://templates`) | [`mcp/resources.md`](./mcp/resources.md)           |
| Prompts (`wa-template-send`)                                | [`mcp/prompts.md`](./mcp/prompts.md)               |
| Auth (env vars / CLI flags)                                 | [`mcp/auth.md`](./mcp/auth.md)                     |
| Error recovery (what each `isError: true` means)            | [`mcp/error-recovery.md`](./mcp/error-recovery.md) |
| Transports (stdio today, HTTP later)                        | [`mcp/transports.md`](./mcp/transports.md)         |

## Cookbook ([`cookbook/`](./cookbook/))

Walkthroughs. Each recipe is end-to-end runnable.

### SDK only ([`cookbook/sdk/`](./cookbook/sdk/))

- [`inbound-auto-responder.md`](./cookbook/sdk/inbound-auto-responder.md) —
  simplest possible echo bot
- [`two-way-support-with-handoff.md`](./cookbook/sdk/two-way-support-with-handoff.md) —
  customer support with agent escalation
- [`transactional-notification.md`](./cookbook/sdk/transactional-notification.md) —
  one-off template sends from internal events
- [`appointment-booking.md`](./cookbook/sdk/appointment-booking.md) —
  slot-collection flow with interactive list
- [`multi-tenant.md`](./cookbook/sdk/multi-tenant.md) — one process,
  many WABAs
- [`cloudflare-workers.md`](./cookbook/sdk/cloudflare-workers.md) —
  webhook receiver on Workers
- [`hono.md`](./cookbook/sdk/hono.md) — Hono adapter

### MCP only ([`cookbook/mcp/`](./cookbook/mcp/))

- [`claude-desktop.md`](./cookbook/mcp/claude-desktop.md) — install +
  send your first message
- [`claude-agent-sdk.md`](./cookbook/mcp/claude-agent-sdk.md) —
  embed `WhatsAppMcpServer` in-process inside a Claude Agent SDK
  runtime
- [`multi-server-claude-desktop.md`](./cookbook/mcp/multi-server-claude-desktop.md) —
  one MCP server per WABA in one Claude Desktop config

### Hybrid — SDK + MCP together ([`cookbook/hybrid/`](./cookbook/hybrid/))

The strongest production patterns.

- [`agent-handoff-loop.md`](./cookbook/hybrid/agent-handoff-loop.md) —
  the canonical full loop: agent sends outbound, server receives
  inbound, server routes back to agent
- [`inbound-routed-to-agent.md`](./cookbook/hybrid/inbound-routed-to-agent.md) —
  inbound-first variant with intent classification
- [`compliance-broadcast.md`](./cookbook/hybrid/compliance-broadcast.md) —
  consent-ledger gate on agent-triggered broadcasts
