# Transports

The MCP protocol is transport-agnostic. The protocol's
JSON-RPC 2.0 messages travel over whatever bidirectional
channel the host and server agree on.

## v1: stdio

`@dojocoding/whatsapp-mcp` v0.x ships **stdio only**. The bin is
spawned as a child process by the MCP host; JSON-RPC messages
flow over the child's stdin and stdout.

```
MCP host                 ┌──────────────────────────────┐
(Claude Desktop, ─────▶  │ npx @dojocoding/whatsapp-mcp │ ─▶ Meta Graph API
 Cursor, Cline, ...)     │   (stdio MCP server)         │
                         └──────────────────────────────┘
                            ▲                ▲
                            │ stdin          │ stderr
                            │ stdout         │ (logs only)
                            ▼
                         JSON-RPC frames
```

### Why stdio first

- **What every MCP host implements.** Claude Desktop, Cursor,
  Cline, the Anthropic Claude Agent SDK — all spawn child
  processes and talk stdio. Other transports exist in the spec
  but adoption is uneven (May 2026).
- **Zero infrastructure.** No HTTP server, no public URL, no
  certificate management. `npx -y @dojocoding/whatsapp-mcp`
  in `claude_desktop_config.json` is the whole setup.
- **Credentials live on-machine.** The token never leaves your
  computer; the agent host spawns a local subprocess that talks
  to Meta directly.

### The stdio gotcha

The MCP server **must not write to stdout** outside the
JSON-RPC framing. Stray `console.log` corrupts the
host's parser and Claude reports the server as dead.

`@dojocoding/whatsapp-mcp` routes every diagnostic to stderr:

```ts
process.stderr.write(`@dojocoding/whatsapp-mcp listening...\n`);
```

If you fork the source and add logging, follow the same pattern.
`console.log` is deliberately not used anywhere in the package.

### Logs

Diagnostics go to stderr. MCP hosts route this somewhere:

- **Claude Desktop, macOS:** `~/Library/Logs/Claude/mcp.log`
- **Claude Desktop, Windows:** `%APPDATA%\Claude\logs\mcp.log`
- **Cursor / Cline:** the host's developer console.

Control verbosity with `MCP_LOG_LEVEL` (`debug` / `info` /
`warn` / `error`). Default `info`. See [`auth.md`](./auth.md)
for the full env-var table.

## Testing the spawned bin

The contract test suite (`packages/whatsapp-mcp/test/contract/`)
drives the server through `InMemoryTransport.createLinkedPair()`
— JavaScript objects shuffled by reference, no real stdio, no
JSON byte serialization. That's the right shape for testing the
**logic** (every tool handler, every error path, every recovery
hint) but it intentionally skips the **packaging + runtime +
protocol-on-wire** failure modes a real spawn would expose.

The **end-to-end suite** at `packages/whatsapp-mcp/test/e2e/`
fills that gap. Gated on `WHATSAPP_MCP_E2E=1`:

```bash
# Local run
WHATSAPP_MCP_E2E=1 pnpm --filter @dojocoding/whatsapp-mcp test

# CI: triggered manually or nightly via .github/workflows/mcp-e2e.yml
```

The suite uses `WHATSAPP_MODE=mock` so it needs no Meta
credentials. It builds `dist/cli.js`, spawns it as a real Node
subprocess via `child_process.spawn`, drives JSON-RPC over real
stdin/stdout, and asserts:

- The shebang resolved (file invokable as a Node script).
- `chmod +x` was set (executable bit present).
- Missing required env vars → process exits with code 1 + stderr
  message naming the missing field.
- `initialize` → `tools/list` returns the 16 expected tools.
- `tools/call whatsapp_send_text` round-trips with the response
  `structuredContent.messageId` matching `/^wamid\.mock-\d+/`
  (mock-mode signal).
- Every non-empty line on stdout parses as valid JSON-RPC
  (no `console.log` leakage).
- The `MOCK MODE` banner appears on **stderr**, never stdout.
- Process exits cleanly (code 0) when stdin is closed.

The whole suite runs in ~1.5 seconds; the gating keeps it out
of the per-PR CI gate. The nightly workflow at
`.github/workflows/mcp-e2e.yml` catches regressions shortly
after they land on main.

### What the E2E suite covers that contract tests can't

| Failure mode                                              | Contract test sees it?  | E2E test sees it? |
| --------------------------------------------------------- | ----------------------- | ----------------- |
| Tool handler logic bug                                    | ✅                      | ✅                |
| Recovery hint wording                                     | ✅                      | ✅                |
| Drift in tool / resource / prompt names                   | ✅ (via drift detector) | ✅                |
| tsup `banner` config drops the shebang                    | ❌                      | ✅                |
| `onSuccess` chmod step fails silently                     | ❌                      | ✅                |
| `console.log` leak corrupting JSON-RPC framing            | ❌                      | ✅                |
| Missing runtime dep (added to source, not `dependencies`) | ❌                      | ✅                |
| Env loader doesn't actually `process.exit(1)`             | ❌                      | ✅                |
| `bin` entry points at the wrong path                      | ❌                      | ✅                |
| Newline-delimited framing bug                             | ❌                      | ✅                |

## v2 (planned): Streamable HTTP

The next MCP transport revision is **Streamable HTTP** — a
single bidirectional `POST /mcp` endpoint that lets the server
push notifications back to the client via long-lived
chunked-transfer responses.

We'll ship a Streamable HTTP transport when:

- Adoption among major MCP hosts crosses the threshold where
  "remote MCP server" is a realistic deployment target. As of
  May 2026, Claude.ai (web) supports it but most other hosts
  don't yet.
- We have a credential-handling story we're happy with — most
  likely OAuth Resource Server (RFC 8707), matching the MCP
  spec's `2025-06` revision for hosted servers.

If you need a hosted MCP server today, the workaround is a
small HTTP-to-stdio bridge — an Express endpoint that pipes
requests into a long-running `dojo-whatsapp-mcp` subprocess.
The
[Hookdeck MCP Gateway pattern](https://hookdeck.com/blog/mcp-event-gateway)
documents this approach.

## SSE (deprecated)

The original `HTTP+SSE` transport from MCP spec `2024-11-05` is
deprecated. The MCP SDK still ships an SSE transport class for
backwards compat, but new servers should not target it. We do
**not** export an SSE wrapper from `@dojocoding/whatsapp-mcp`.

## Programmatic / in-memory

For testing and for embedding inside larger agent runtimes,
the MCP SDK ships an `InMemoryTransport` (paired one-process
transports). `@dojocoding/whatsapp-mcp`'s contract tests use
this:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WhatsAppMcpServer } from "@dojocoding/whatsapp-mcp";

const server = new WhatsAppMcpServer({ client, wabaPhoneNumberId });
const [a, b] = InMemoryTransport.createLinkedPair();
const mcpClient = new Client({ name: "host", version: "0.0.0" }, {});
await Promise.all([server.connect(a), mcpClient.connect(b)]);

// mcpClient.callTool({...}) drives the server in-process.
```

This is also the pattern for the Claude Agent SDK — see
[`cookbook/mcp/claude-agent-sdk.md`](../cookbook/mcp/claude-agent-sdk.md).

## Custom transports

`WhatsAppMcpServer.connect(transport)` accepts any class that
implements the MCP SDK's `Transport` interface (
`@modelcontextprotocol/sdk/shared/transport.js`). If you build
a custom transport — over a Unix socket, a Cloudflare Durable
Object, an MQTT topic, whatever — pass it in. The server's
tool/resource/prompt registrations are transport-agnostic.
