# MCP server quickstart — Claude Desktop in 5 minutes

This walkthrough takes you from zero to "Claude sent my first
WhatsApp message" in five minutes. The MCP server runs as a stdio
child process Claude Desktop spawns on demand — no servers to
host, no infrastructure to set up.

## Prerequisites

1. A WhatsApp Business Account (WABA) with at least one phone
   number registered. If you're starting from scratch, follow
   [Meta's WhatsApp Cloud API onboarding](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started).
2. A long-lived BISU or System User access token with
   `whatsapp_business_messaging` scope.
3. The WABA's phone-number-id (find it under
   [WhatsApp → API Setup](https://developers.facebook.com/apps/) in
   Meta's dashboard).
4. Claude Desktop (or another MCP-compatible host: Cursor, Cline,
   etc.). The config-file path differs per host — Claude Desktop
   uses `~/Library/Application Support/Claude/claude_desktop_config.json`
   on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on
   Windows.
5. Node.js 20+ (the MCP host invokes `npx`, which needs Node).

## Configure Claude Desktop

Open the config file and add an entry under `mcpServers`:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npx",
      "args": ["-y", "@dojocoding/whatsapp-mcp"],
      "env": {
        "WHATSAPP_ACCESS_TOKEN": "EAAG...your-token...",
        "WHATSAPP_PHONE_NUMBER_ID": "1234567890",
        "WHATSAPP_BUSINESS_ACCOUNT_ID": "9876543210"
      }
    }
  }
}
```

`WHATSAPP_BUSINESS_ACCOUNT_ID` is optional but recommended — it
unlocks the template-registry read tools (`whatsapp_list_templates`,
`whatsapp_get_template`) and the `whatsapp://templates` resource.

Restart Claude Desktop. The first `npx` invocation downloads the
package (~10 MB), so it may take a few seconds. Subsequent spawns
are instant.

## Verify the connection

Open a new chat in Claude Desktop. Type:

```
List the WhatsApp tools you have access to.
```

Claude should list 16 tools prefixed `whatsapp_*` (send_text,
send_template, etc.) plus 2 resources (`whatsapp://window/...`,
`whatsapp://templates`) plus 1 prompt (`wa-template-send`). If
nothing shows up, see the Troubleshooting section below.

## Send your first message

The 24-hour customer-service window is closed for any recipient
you haven't messaged before. To open it, ask Claude:

```
Send a hello message to +5210000000001 using whatsapp_send_template
with the hello_world template (en_US).
```

Claude will call `whatsapp_send_template` with the
`hello_world` template (Meta ships this template approved by
default on every WABA). Once the customer replies, the 24-hour
window opens and `whatsapp_send_text` works for free-form sends.

## Use the guided prompt

In Claude Desktop, type `/wa-template-send` in the prompt
picker. The MCP server emits a guided walkthrough that:

1. Lists approved templates via the `whatsapp://templates`
   resource.
2. Fetches the chosen template's schema via
   `whatsapp_get_template`.
3. Asks you for variable values.
4. Calls `whatsapp_send_template`.

This is the easiest path for sending a marketing or transactional
template — Claude handles the parameter shape for you.

## What happens when the window is closed

If you ask Claude to send a free-form message to a recipient
whose 24-hour window is closed, the server returns
`isError: true` with the recovery hint:

> The 24-hour customer-service window is closed for this
> recipient. Use `whatsapp_send_template` with an approved
> template to re-engage.

Claude reads this and re-routes through `whatsapp_send_template`.
You don't have to instruct it; the recovery hint is self-explanatory.

## What's NOT available out-of-the-box

- **Receiving inbound messages.** Claude Desktop can't subscribe
  to webhooks. If you need an agent to react to replies, you
  need both packages — see
  [`docs/cookbook/hybrid/agent-handoff-loop.md`](../cookbook/hybrid/agent-handoff-loop.md).
- **Window-state for unseeded recipients.** The
  `whatsapp://window/{phone}` resource returns `isOpen: false`
  by default because the MCP server doesn't see inbound traffic.
  See [`resources.md`](./resources.md) for how to wire a shared
  `Storage` backend so the server can read state populated by
  your webhook receiver.
- **Multi-WABA from one server.** One MCP server process speaks
  for one WABA-phone pair. To support more, run multiple servers
  — see
  [`cookbook/mcp/multi-server-claude-desktop.md`](../cookbook/mcp/multi-server-claude-desktop.md).

## Troubleshooting

**Claude doesn't see the tools.**
Check the Claude Desktop logs (`~/Library/Logs/Claude/mcp.log` on
macOS). The most common cause is missing env vars — the server
exits with code 1 and a stderr message naming the missing field.

**`Cannot find module @dojocoding/whatsapp-mcp`.**
`npx` failed to fetch the package. Run
`npx -y @dojocoding/whatsapp-mcp` manually in a terminal to see
the npm error. If your machine is behind a corporate proxy, set
`HTTPS_PROXY` in the same `env` block.

**`Tool returned isError: true` for every send.**
Either the access token is invalid (see the recovery hint —
"verify `WHATSAPP_ACCESS_TOKEN`") or the phone-number-id doesn't
match the token's WABA. Verify both in Meta's dashboard.

**Stdout corruption / `Unexpected token in JSON`.**
The server must never write to stdout outside JSON-RPC frames. If
you've modified the source code, ensure every `console.log` is
replaced with `console.error` or `process.stderr.write`. The
default build is already compliant.

## Next steps

- [Tools reference](./tools.md) — what every tool does, when to
  use each.
- [Auth](./auth.md) — full env-var + CLI-flag table.
- [Error recovery catalogue](./error-recovery.md) — every
  `isError: true` shape and what the LLM should do.
- [Hybrid cookbook](../cookbook/hybrid/) — pair the MCP server
  with the SDK's webhook receiver.
