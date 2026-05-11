# Auth + configuration

The MCP server reads credentials from **environment variables**,
with optional CLI flag fallback. It **never** accepts credentials
as tool-call arguments — the spec forbids this because the model
could echo a token back in `content[].text` and leak it into
training data, logs, or shared transcripts.

## Required

| Env var                    | CLI flag            | Purpose                                                            |
| -------------------------- | ------------------- | ------------------------------------------------------------------ |
| `WHATSAPP_ACCESS_TOKEN`    | `--access-token`    | BISU or System User token with `whatsapp_business_messaging` scope |
| `WHATSAPP_PHONE_NUMBER_ID` | `--phone-number-id` | the phone-number-id this server speaks for                         |

Missing required values cause the bin to exit with code 1 and a
clear stderr message naming the missing field(s):

```
Missing required configuration: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID.
Set the equivalent environment variable(s) or pass the matching --flag on
the command line. Required: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID.
```

## Optional

| Env var                        | CLI flag                | Default     | Purpose                                                                                                     |
| ------------------------------ | ----------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `--business-account-id` | empty       | required for `whatsapp_list_templates` + `whatsapp_get_template`; if you don't use those tools, leave unset |
| `WHATSAPP_API_VERSION`         | `--api-version`         | SDK default | pin a specific Graph API version (e.g. `v25.0`)                                                             |
| `WHATSAPP_APP_SECRET`          | `--app-secret`          | empty       | reserved for future inbound surface; not used by v1 tools                                                   |
| `WHATSAPP_MODE`                | `--mode`                | `real`      | `real` \| `mock` — `mock` swaps in `MockWhatsAppClient` (no Meta calls). See "Preview / mock mode" below.   |
| `MCP_LOG_LEVEL`                | `--log-level`           | `info`      | one of `debug` / `info` / `warn` / `error`                                                                  |

## Precedence

CLI flag > env var. Stripe's MCP server uses this same pattern;
it lets you override env vars for one-off testing without
mutating shell state.

```bash
# Env var only
WHATSAPP_ACCESS_TOKEN=A WHATSAPP_PHONE_NUMBER_ID=p \
  npx -y @dojocoding/whatsapp-mcp

# CLI flag overrides env var
WHATSAPP_ACCESS_TOKEN=A WHATSAPP_PHONE_NUMBER_ID=p \
  npx -y @dojocoding/whatsapp-mcp --access-token=B
# → server uses access-token "B"

# Long form vs equals form (both supported)
npx -y @dojocoding/whatsapp-mcp \
  --access-token A \
  --phone-number-id p

npx -y @dojocoding/whatsapp-mcp \
  --access-token=A \
  --phone-number-id=p
```

## Canonical Claude Desktop config

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

The config file location depends on the MCP host:

- **Claude Desktop, macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop, Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor:** `.cursor/mcp.json` (per-project) or `~/.cursor/mcp.json`
- **Cline (VS Code extension):** workspace `.vscode/mcp.json`

## Preview / mock mode

`WHATSAPP_MODE=mock` swaps in `MockWhatsAppClient` (via the SDK's
[`pickWhatsAppClient`](../sdk/mock.md) factory) instead of the
real `WhatsAppClient`. The bin:

- Never opens a network connection to `graph.facebook.com`.
- Returns deterministic `wamid.mock-1`, `wamid.mock-2`, ... from
  every send tool.
- Writes the line `MOCK MODE — preview only; no Meta calls` to
  **stderr** at startup so operators can confirm the mode they
  booted into.
- Still requires `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`
  to be set (any non-empty strings) — the env loader's required-field
  contract is unchanged. The mock just doesn't validate them.

The **tool / resource / prompt surface is byte-identical** to
real mode. The agent sees the same 16 tools, the same 2
resources, the same prompt. Only the upstream target differs.

### When to use it

- **Setup verification.** Wire up Claude Desktop, confirm
  tools/list appears, send a `whatsapp_send_text` — all before
  provisioning a real WABA.
- **Prompt-engineering iteration.** Test agent prompts that
  drive the WhatsApp tools without burning Meta quota or
  Meta-side WABA-quality scoring on practice runs.
- **Downstream consumer CI.** Front-Desk-style orchestrator
  templates can run their full agent-handoff-loop test in
  mock mode without needing a Meta test number.

### Canonical mock-mode Claude Desktop config

```json
{
  "mcpServers": {
    "whatsapp-preview": {
      "command": "npx",
      "args": ["-y", "@dojocoding/whatsapp-mcp"],
      "env": {
        "WHATSAPP_MODE": "mock",
        "WHATSAPP_ACCESS_TOKEN": "dev-only-not-used",
        "WHATSAPP_PHONE_NUMBER_ID": "dev-only-not-used"
      }
    }
  }
}
```

**Don't ship this to production.** The bin loudly warns on
stderr but Claude Desktop won't tell you visually. Keep the
mock-mode server entry separately-named (e.g.
`whatsapp-preview`) so you don't confuse it with your real WABA
entry.

## Multi-WABA

One MCP server process speaks for **one WABA-phone pair** — the
SDK's "one library instance per WABA-phone pair" invariant
carries through. For multi-WABA deployments, run N MCP servers
side-by-side. Each gets its own `mcpServers.<name>` block with
its own env vars.

See [`cookbook/mcp/multi-server-claude-desktop.md`](../cookbook/mcp/multi-server-claude-desktop.md)
for the template.

## What the model never sees

By design, the model cannot read or echo any credential:

- **No tool's `inputSchema` declares an `accessToken`,
  `phoneNumberId`, `appSecret`, or `businessAccountId` field.**
  Drift-detected in the public-surface test.
- **`AuthenticationError` recovery hints are redacted.** When
  Meta rejects the token, the resulting `structuredContent.error.message`
  is a fixed string, not the SDK's raw error message (which
  echoes the token in some failure paths). Drift-detected by a
  unit test that asserts the token value never appears in any
  field of the response.

## Why env vars and not OAuth?

For a local stdio MCP server, env vars are simpler, lower-latency,
and don't require a callback URL. The MCP spec's OAuth flow (MCP
Resource Server in the 2025-06 spec revision) is for **remote**
hosted servers — when we ship a Streamable HTTP transport in
v2, OAuth becomes relevant. For now: env vars.

See [`transports.md`](./transports.md) for the transport roadmap.

## Programmatic embedding (skip env loading)

For the Claude Agent SDK case where you build the server
in-process, skip the env-var loader entirely:

```ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { WhatsAppMcpServer } from "@dojocoding/whatsapp-mcp";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
});

const server = new WhatsAppMcpServer({
  client,
  wabaPhoneNumberId: client.phoneNumberId,
});

// Connect to whatever transport you prefer (in-memory for tests,
// custom transports, etc.).
```

In this mode you're free to source credentials from anywhere
(Vault, AWS Secrets Manager, a TokenProvider callback) — the
no-credentials-in-tool-args invariant is enforced by the tool
schemas themselves, not by the env loader.
