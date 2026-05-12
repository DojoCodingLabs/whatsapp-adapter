# MCP reference

Reference docs for `@dojocoding/whatsapp-mcp` — the Model Context
Protocol server that wraps `@dojocoding/whatsapp-sdk`'s outbound
surface as MCP tools, resources, and prompts.

## v1 scope: send-only

The MCP server's v1 surface is **outbound only** — 16 send tools,
the read-only window-state and template-list resources, and the
`wa-template-send` prompt. **Inbound webhooks are not in MCP v1
and won't be**: stdio MCP hosts (Claude Desktop, Cursor, Cline)
spawn the server as a child process and can't host the HTTP
listener Meta needs to deliver webhook payloads. Agents that
need to react to inbound traffic pair the MCP server (for sends)
with the SDK's `WebhookReceiver` (for receives) — see the
[hybrid cookbook](../cookbook/hybrid/), specifically
[`agent-handoff-loop.md`](../cookbook/hybrid/agent-handoff-loop.md).

A future Streamable HTTP transport (MCP spec revision `2025-06`,
OAuth-protected) lands additively on a future minor release; see
[`transports.md`](./transports.md) for the roadmap.

## Pages

- [`quickstart.md`](./quickstart.md) — Claude Desktop in 5
  minutes (including a mock-mode preview that needs no Meta
  credentials).
- [`tools.md`](./tools.md) — all 16 tools, when to use each, and
  the canonical `inputSchema` shape per tool.
- [`resources.md`](./resources.md) — `whatsapp://window/{phone}`
  and `whatsapp://templates` semantics.
- [`prompts.md`](./prompts.md) — `wa-template-send` walkthrough.
- [`auth.md`](./auth.md) — env vars + CLI flags, precedence,
  multi-WABA, mock mode.
- [`transports.md`](./transports.md) — stdio today, Streamable
  HTTP later; what the spawn-the-bin E2E suite catches that
  in-process contract tests can't.
- [`embedded.md`](./embedded.md) — `createWhatsAppToolset` —
  the flat, callable surface for embedding the 16 tools / 2
  resources / 1 prompt inside an outer MCP gateway or in
  non-MCP code, without spinning a stdio server.
- [`error-recovery.md`](./error-recovery.md) — every
  `isError: true` shape, its recovery hint, and what the LLM
  should do next.

## Stability

The tool / resource / prompt names exported as constants from
`packages/whatsapp-mcp/src/index.ts` (`SEND_TEXT_TOOL`,
`WINDOW_RESOURCE_URI_TEMPLATE`, etc.) are stable under semver
from v1.0.0 onwards. See [`../../MIGRATION.md`](../../MIGRATION.md)
§ "MCP server: `0.3.x` → `1.0.0`" for the full stability matrix.
