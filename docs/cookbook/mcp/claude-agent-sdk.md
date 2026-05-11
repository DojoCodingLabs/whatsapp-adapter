# Embedding inside a Claude Agent SDK runtime

The `npx -y @dojocoding/whatsapp-mcp` flow is right for Claude
Desktop and other host-as-spawner runtimes. If you're building
an **autonomous agent** with the Claude Agent SDK
(`@anthropic-ai/claude-agent-sdk`) — a long-running process that
holds a Claude session and drives tools programmatically — you
probably want to embed the MCP server **in-process** instead of
spawning a subprocess.

This recipe walks through that pattern.

## Why embed?

- **Lower latency.** No process spawn per tool call. Tool calls
  route through `InMemoryTransport` (essentially a JS object).
- **Shared state.** The MCP server can see the same
  `WindowTracker`, `Storage`, and `WhatsAppClient` your agent
  process already uses. The `whatsapp://window/{phone}` resource
  becomes useful — it reflects state populated by your inbound
  webhook receiver in the same process.
- **No process management.** Forget about `npx`'s download
  cache, subprocess crashes, and signal handling.

The tradeoff: you lose the `claude_desktop_config.json` UX —
your application code is now responsible for wiring the agent
to the server. For agent runtimes, that's already the model.

## Sketch

```ts
import { ClaudeSDKClient } from "@anthropic-ai/claude-agent-sdk";
import {
  InMemoryStorage,
  WebhookReceiver,
  WhatsAppClient,
  WindowTracker,
} from "@dojocoding/whatsapp-sdk";
import { WhatsAppMcpServer } from "@dojocoding/whatsapp-mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// 1. Build the SDK pieces.
const storage = new InMemoryStorage(); // or createRedisStorage(...) in prod
const windowTracker = new WindowTracker({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  storage,
});
const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
  windowTracker,
});

// 2. Build the MCP server and connect it to an in-memory transport.
const mcpServer = new WhatsAppMcpServer({
  client,
  wabaPhoneNumberId: client.phoneNumberId,
  windowTracker, // ← key bit: same tracker the WhatsAppClient uses
});

const [serverEnd, clientEnd] = InMemoryTransport.createLinkedPair();
await mcpServer.connect(serverEnd);

// 3. Hand the client end to the Claude Agent SDK.
const agent = new ClaudeSDKClient({
  mcpServers: { whatsapp: { transport: clientEnd } },
  // ... other Agent SDK options
});

// 4. Wire your webhook receiver in the same process.
const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  storage,
});
receiver.on("message", (event) => {
  // 5. Populate the window tracker so the MCP server's
  //    whatsapp://window/{phone} resource is accurate.
  void windowTracker.notifyInbound(event.from);

  // 6. Route inbound to the agent. Two common patterns —
  //    pick one (or do both).

  // Option A: append to the agent's conversation queue.
  void agent.appendUserMessage(`Customer ${event.from} said: ${describe(event)}`);

  // Option B: kick off a separate Claude run per inbound.
  // void agent.runOnce({
  //   systemPrompt: "Handle the customer's reply.",
  //   userMessage: describe(event),
  // });
});

function describe(event: import("@dojocoding/whatsapp-sdk").MessageInboundEvent): string {
  switch (event.message.type) {
    case "text":
      return event.message.text;
    case "image":
      return "[image]";
    case "audio":
      return "[audio]";
    default:
      return `[${event.message.type}]`;
  }
}
```

The exact `ClaudeSDKClient` API surface depends on the version
you're using — see the
[Claude Agent SDK docs](https://docs.claude.com/en/docs/agents/sdk).
The piece that's stable here is **the transport hand-off**:
`createLinkedPair()` → `mcpServer.connect(serverEnd)` →
`clientEnd` goes to the agent.

## What you gain

### The window resource actually works

```
agent: read whatsapp://window/+5210000000001
→ { "phone": "+5210000000001", "isOpen": true }
```

Because both the agent and the receiver share the same
`WindowTracker`, the MCP resource is accurate. The agent can
gate its own behaviour: read the window state, choose
free-form vs template path.

### Shared observability

If you've wired OpenTelemetry into the SDK
(`@opentelemetry/api`), the agent's tool calls roll into the
same trace as the inbound webhook handlers. End-to-end visibility
into "customer message → agent decision → outbound send" is one
trace tree, not three.

### No credential exposure

The agent never sees the token. It's read once at startup,
passed to `WhatsAppClient`, and the MCP tools call into the
client by reference. The
[no-credentials-in-tool-args](../mcp/auth.md) invariant is
preserved.

## When NOT to do this

- **You only need a slash command in Claude Desktop.** Stick
  with the `npx` flow.
- **The agent runtime is on a different host than the
  receiver.** You can't share an in-memory `WindowTracker`
  across machines. Use a Redis-backed `Storage` and run both
  processes pointing at the same Redis (or, for the agent side,
  give the MCP server a `WindowTracker` that reads-only — the
  receiver process is the writer).

## Tests

Embedding via `InMemoryTransport` is exactly how
`@dojocoding/whatsapp-mcp`'s own contract tests work — see
`packages/whatsapp-mcp/test/contract/server.test.ts` for a
minimal reference shape. If you're building a custom agent
runtime, copy that shape for your unit tests.
