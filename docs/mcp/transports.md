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
