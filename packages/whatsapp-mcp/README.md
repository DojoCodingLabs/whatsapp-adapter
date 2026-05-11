# @dojocoding/whatsapp-mcp

A Model Context Protocol (MCP) server that surfaces the WhatsApp
Cloud API's outbound side as **16 tools, 2 resources, and 1
prompt** for LLM agents (Claude Desktop, the Claude Agent SDK,
Cursor, Cline).

> **Sibling package:** [`@dojocoding/whatsapp-sdk`](https://www.npmjs.com/package/@dojocoding/whatsapp-sdk).
> Use the SDK directly when you're building a server that
> handles WhatsApp webhooks. Use this MCP server when you're
> wiring an LLM to send WhatsApp messages. Use both together
> for the agent ↔ customer loop —
> see [`docs/cookbook/hybrid/agent-handoff-loop.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/cookbook/hybrid/agent-handoff-loop.md).

## Install

Add to your MCP host's config (Claude Desktop shown):

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npx",
      "args": ["-y", "@dojocoding/whatsapp-mcp"],
      "env": {
        "WHATSAPP_ACCESS_TOKEN": "EAAG...",
        "WHATSAPP_PHONE_NUMBER_ID": "1234567890",
        "WHATSAPP_BUSINESS_ACCOUNT_ID": "9876543210",
      },
    },
  },
}
```

Restart Claude Desktop. First spawn pulls the package (~10 MB);
subsequent spawns are instant.

## Use

In a Claude Desktop chat:

```
Send the hello_world template (en_US) to +5210000000001 via WhatsApp.
```

Or open the prompt picker and choose `/wa-template-send` for a
guided walkthrough that lists approved templates, fetches the
chosen template's schema, asks you for variables, and sends.

For programmatic embedding (Claude Agent SDK, custom hosts):

```ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { WhatsAppMcpServer } from "@dojocoding/whatsapp-mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
});

const server = new WhatsAppMcpServer({ client, wabaPhoneNumberId: client.phoneNumberId });
const [serverEnd, clientEnd] = InMemoryTransport.createLinkedPair();
await server.connect(serverEnd);
// Hand `clientEnd` to your MCP-compatible agent runtime.
```

## What this package is / is NOT

- **Is**: an MCP stdio server exposing every `WhatsAppClient.sendX(...)`
  method as a tool, with zod-validated inputs and per-error recovery
  hints the LLM can act on (`WINDOW_CLOSED` → "use template",
  `TEMPLATE` → "inspect via `whatsapp_get_template`", etc.).
- **Is NOT**: a webhook receiver. The MCP server doesn't see
  inbound traffic — that's the SDK's job. To make an agent react to
  customer replies, pair this with the SDK's `WebhookReceiver` in
  the same process. See the
  [hybrid cookbook](https://github.com/DojoCodingLabs/whatsapp-adapter/tree/main/docs/cookbook/hybrid).
- **Is NOT**: an HTTP server. v1 supports stdio only; remote
  hosting via Streamable HTTP is a v2 candidate (see
  [`docs/mcp/transports.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/mcp/transports.md)).

## Docs

→ [`docs/mcp/`](https://github.com/DojoCodingLabs/whatsapp-adapter/tree/main/docs/mcp)
on GitHub.

- [`quickstart.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/mcp/quickstart.md) —
  Claude Desktop in 5 minutes.
- [`tools.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/mcp/tools.md) —
  every tool's input + output shape.
- [`resources.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/mcp/resources.md),
  [`prompts.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/mcp/prompts.md) —
  read-only state + the slash-command prompt.
- [`auth.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/mcp/auth.md) —
  env vars, CLI flags, multi-WABA.
- [`error-recovery.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/mcp/error-recovery.md) —
  the recovery-hint catalogue.

Cookbook recipes:
[`docs/cookbook/mcp/`](https://github.com/DojoCodingLabs/whatsapp-adapter/tree/main/docs/cookbook/mcp)
(Claude Desktop + Claude Agent SDK + multi-WABA) and
[`docs/cookbook/hybrid/`](https://github.com/DojoCodingLabs/whatsapp-adapter/tree/main/docs/cookbook/hybrid)
(SDK + MCP together — the production-default).

## License

MIT © Dojo Coding LLC.
