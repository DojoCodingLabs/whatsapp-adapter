# Multiple MCP servers, one per WABA

The MCP server speaks for one WABA-phone pair. This honours the
SDK's "one client per pair" invariant — different WABAs use
different access tokens, may live in different Meta Business
Accounts, and have independent rate limits.

For multi-WABA deployments, run **multiple MCP server processes
side-by-side**, each with its own credentials.

## The config shape

`claude_desktop_config.json` accepts any number of entries under
`mcpServers`. Give each a descriptive name — Claude uses these
names to disambiguate tools across servers.

```json
{
  "mcpServers": {
    "whatsapp-support": {
      "command": "npx",
      "args": ["-y", "@dojocoding/whatsapp-mcp"],
      "env": {
        "WHATSAPP_ACCESS_TOKEN": "EAAG-support-token...",
        "WHATSAPP_PHONE_NUMBER_ID": "111111111111",
        "WHATSAPP_BUSINESS_ACCOUNT_ID": "222222222222"
      }
    },
    "whatsapp-marketing": {
      "command": "npx",
      "args": ["-y", "@dojocoding/whatsapp-mcp"],
      "env": {
        "WHATSAPP_ACCESS_TOKEN": "EAAG-marketing-token...",
        "WHATSAPP_PHONE_NUMBER_ID": "333333333333",
        "WHATSAPP_BUSINESS_ACCOUNT_ID": "444444444444"
      }
    },
    "whatsapp-mx": {
      "command": "npx",
      "args": ["-y", "@dojocoding/whatsapp-mcp"],
      "env": {
        "WHATSAPP_ACCESS_TOKEN": "EAAG-mx-token...",
        "WHATSAPP_PHONE_NUMBER_ID": "555555555555",
        "WHATSAPP_BUSINESS_ACCOUNT_ID": "666666666666"
      }
    }
  }
}
```

Each server gets its own child process, its own credentials, its
own state.

## How Claude addresses each server

Claude's tool surface namespaces tool calls by server name. The
same `whatsapp_send_text` exists three times in the example
above — once per server. You ask Claude:

```
Send "Your appointment is confirmed" to +5210000000001
using the whatsapp-support WABA.
```

Claude picks the correct server based on your phrasing. If you
ask ambiguously ("send a WhatsApp..."), Claude will either
disambiguate by asking or pick the most-recently-used server.

The MCP server stamps the `wabaPhoneNumberId` into every
`structuredContent` so Claude can confirm which WABA it just
acted on:

```
Sent wamid.HBgN... to +5210000000001 (waba phone 111111111111).
```

## Resource scoping

Each server's resources are also namespaced. Reading
`whatsapp://templates` against the `whatsapp-support` server is
distinct from reading the same URI against `whatsapp-marketing`
— different cached lists, different cache TTL clocks. Claude
addresses these by server name as well.

## Per-server log channels

All servers write to the same `mcp.log` file under Claude
Desktop's logs directory. Each line is prefixed with the server
name so you can grep:

```bash
grep '\[whatsapp-marketing\]' ~/Library/Logs/Claude/mcp.log
```

## Cost / process budget

Each spawned MCP server is a Node process holding ~50–100 MB
resident. Three servers is fine; thirty is a stretch on a
laptop. For high-fanout multi-tenant scenarios (hundreds of
WABAs), don't use this pattern — run a **single agent process**
that wires the SDK directly (no MCP server per WABA) and uses
`pickWhatsAppClient` or a custom token-provider callback to
route per request. The Claude Agent SDK pattern in
[`claude-agent-sdk.md`](./claude-agent-sdk.md) is the
foundation; multi-WABA is a small extension on top.

## Shared credentials across servers (don't)

It's tempting to put `WHATSAPP_ACCESS_TOKEN` once at the top of
the config and reference it from each server. Claude Desktop's
JSON config doesn't support that — each `env` block is its own
map. **This is by design**: different WABAs really do use
different tokens (Meta scopes tokens per Business Account).
Sharing one token across multiple `phoneNumberId`s either
doesn't work (token doesn't have access) or breaks the
audit trail (Meta logs all sends under the token; you lose
per-WABA observability).

If you find yourself wanting to share a token, you probably
want a **single MCP server with a token-provider callback**
instead — see the SDK's
[`TokenProvider` docs](../../sdk/client.md#tokenprovider).
That's an in-process pattern; the MCP-server-per-WABA pattern
is for the host-spawn case where each subprocess gets only its
own credentials.
