# @dojocoding/whatsapp-mcp

> **Sibling package:** [`@dojocoding/whatsapp-sdk`](../whatsapp-sdk/README.md) — use the SDK directly when you're building a server that handles WhatsApp webhooks. Use this MCP server when you're wiring an LLM agent (Claude Desktop, Claude Agent SDK, Cursor, Cline) to send WhatsApp messages.

An MCP (Model Context Protocol) server that surfaces
[`@dojocoding/whatsapp-sdk`](../whatsapp-sdk/README.md)'s outbound
WhatsApp Cloud API as MCP tools, resources, and prompts.

**Status: skeleton.** Implementation lands in Phase C1 of OpenSpec change
`2026-05-10-add-mcp-server`. The first publishable release will be
`0.1.0`.

## Install (forthcoming)

```bash
npx -y @dojocoding/whatsapp-mcp
```

Drop the following into `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npx",
      "args": ["-y", "@dojocoding/whatsapp-mcp"],
      "env": {
        "WHATSAPP_ACCESS_TOKEN": "EAAG...",
        "WHATSAPP_PHONE_NUMBER_ID": "1234567890"
      }
    }
  }
}
```

## See also

- [`docs/mcp/`](../../docs/mcp/) — full MCP reference (tools, resources,
  prompts, auth, transports, error recovery).
- [`docs/cookbook/mcp/`](../../docs/cookbook/mcp/) — Claude Desktop
  walkthrough, Claude Agent SDK embedding, multi-WABA setups.
- [`docs/cookbook/hybrid/`](../../docs/cookbook/hybrid/) — recipes
  combining this MCP server with the SDK's webhook receiver (e.g.
  agent triggers send, app receives reply, app routes back into the
  agent's runtime).
