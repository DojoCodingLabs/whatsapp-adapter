# Claude Desktop ↔ WhatsApp

This recipe takes you from "I have a WhatsApp WABA" to "Claude
sent a templated message and the customer replied" in one
sitting.

## What you'll have at the end

- Claude Desktop with the `@dojocoding/whatsapp-mcp` server
  configured.
- 16 WhatsApp tools, 2 resources, and 1 slash-command prompt
  available in every Claude chat.
- A successful `hello_world` template send to a real recipient.

## Prerequisites

1. A WhatsApp Business Account (WABA) and at least one verified
   phone number. New accounts: follow
   [Meta's Cloud API onboarding](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started).
2. **Access token.** Generate a long-lived BISU or System User
   token in the Meta Business Suite under
   _System Users → Generate Token_. Scope it to
   `whatsapp_business_messaging` (plus
   `whatsapp_business_management` if you want template-registry
   tools).
3. **Phone-number-id and Business-account-id.** Both are
   visible in _WhatsApp → API Setup_ in the Meta dashboard.
4. **Claude Desktop** (download:
   [claude.ai/download](https://claude.ai/download)).
5. **Node.js 20+** on PATH. `node --version` should print
   `v20.x` or higher.

## Step 1 — locate the config file

| OS      | Path                                                              |
| ------- | ----------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`                     |
| Linux   | `~/.config/Claude/claude_desktop_config.json`                     |

If the file doesn't exist yet, create it with `{}` as the
contents.

## Step 2 — add the MCP server entry

Edit the config file:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npx",
      "args": ["-y", "@dojocoding/whatsapp-mcp"],
      "env": {
        "WHATSAPP_ACCESS_TOKEN": "EAAG...",
        "WHATSAPP_PHONE_NUMBER_ID": "1234567890",
        "WHATSAPP_BUSINESS_ACCOUNT_ID": "9876543210"
      }
    }
  }
}
```

`WHATSAPP_BUSINESS_ACCOUNT_ID` is optional but recommended — it
enables `whatsapp_list_templates` and `whatsapp_get_template`.

## Step 3 — restart Claude Desktop

Quit Claude Desktop and reopen it. On first launch with this
config, Claude downloads `@dojocoding/whatsapp-mcp` via `npx`
(~10 MB; a few seconds on a decent connection). Subsequent
launches are instant.

## Step 4 — verify the connection

In a new chat:

```
What WhatsApp tools do you have access to?
```

Claude should enumerate the 16 tools (`whatsapp_send_text`,
`whatsapp_send_template`, etc.) and mention the resources +
prompt. If you see nothing:

- Open the developer console (View → Developer → Open Developer
  Tools) and look for MCP errors.
- Check `~/Library/Logs/Claude/mcp.log` on macOS or
  `%APPDATA%\Claude\logs\mcp.log` on Windows.
- The most common failure is a missing env var — the server
  exits with code 1 and a clear stderr message naming the
  missing field.

## Step 5 — send your first message

The 24-hour customer-service window is closed for any
recipient you haven't messaged before. Open it by sending the
default `hello_world` template (auto-approved on every WABA):

In Claude Desktop, type:

```
Send the hello_world template (en_US) to +5210000000001 via WhatsApp.
```

Claude calls `whatsapp_send_template` with name=`hello_world`,
language=`en_US`. The MCP server returns:

```
Sent template hello_world (en_US) as wamid.HBgNNTIxOD... to +5210000000001.
```

Check your phone — you should see the message arrive within a
few seconds.

## Step 6 — receive a reply, open the window

Reply to the message from your phone (e.g. "hi"). This opens
the 24-hour window. **The MCP server doesn't see this reply** —
Claude Desktop can't subscribe to webhooks. To make Claude
react to replies, see the hybrid cookbook
[`agent-handoff-loop.md`](../hybrid/agent-handoff-loop.md).

For Claude Desktop alone, the next outbound is now free-form:

```
Send "Thanks for replying! What can I help with?" to +5210000000001.
```

Claude uses `whatsapp_send_text` and the customer receives it.

## Step 7 — use the guided prompt

In Claude Desktop, click the `+` in the prompt picker and
choose `/wa-template-send`. Claude walks you through:

1. Listing available templates (via the `whatsapp://templates`
   resource).
2. Fetching the chosen template's schema via
   `whatsapp_get_template`.
3. Asking you for variable values.
4. Sending.

This is the easiest path for **structured / marketing
templates** — Claude handles the parameter shape and the
common gotchas (language code mismatch, missing variables) for
you.

## What's NOT possible from Claude Desktop alone

- **React to inbound webhooks.** No `WebhookReceiver` runs in
  Claude Desktop. Replies hit your phone (or whatever webhook
  URL you configured in Meta), not Claude's tool surface.
- **Window state.** The `whatsapp://window/{phone}` resource
  returns `isOpen: false` for every phone in this setup because
  the MCP server doesn't observe inbound traffic. Claude
  defaults to assuming the window is closed, which is the safe
  behaviour: it routes to templates.
- **Multi-WABA.** This config has one WABA. For more, see
  [`multi-server-claude-desktop.md`](./multi-server-claude-desktop.md).
- **Conversation history.** Meta's Cloud API doesn't expose a
  history endpoint, and the MCP server doesn't persist
  anything. If you need Claude to remember past conversations,
  persist them yourself in the SDK's webhook receiver.

## Next steps

- **Wire inbound.** Pair the MCP server with the SDK's
  `WebhookReceiver` for the full agent ↔ customer loop. See
  [`hybrid/agent-handoff-loop.md`](../hybrid/agent-handoff-loop.md).
- **Run multiple WABAs.** See
  [`multi-server-claude-desktop.md`](./multi-server-claude-desktop.md).
- **Embed inside the Claude Agent SDK.** See
  [`claude-agent-sdk.md`](./claude-agent-sdk.md).

## Troubleshooting

| Symptom                                             | Fix                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Cannot find module '@dojocoding/whatsapp-mcp'`     | run `npx -y @dojocoding/whatsapp-mcp` in a terminal to see the npm error. Behind a proxy? Add `HTTPS_PROXY` to the env block                                       |
| `Tool returned isError: true` for every send        | check the recovery hint in the response — most likely a bad token (`AUTHENTICATION`) or a closed window for a free-form send (`WINDOW_CLOSED`)                     |
| Claude says it sent the message but nothing arrives | the recipient's number isn't in your WABA's allowed list (dev mode), or the template name / language isn't an approved variant — check via `whatsapp_get_template` |
| Server keeps restarting on every prompt             | corrupted `claude_desktop_config.json` syntax. Validate the JSON                                                                                                   |
