# Embedded toolset — `createWhatsAppToolset`

A flat, callable surface that exposes the same 16 tools / 2
resources / 1 prompt as the stdio `WhatsAppMcpServer`, without
instantiating an MCP `Server` or binding to a transport.

Use this when:

- Your runtime can't host a long-lived stdio child process
  (Vercel serverless, Cloudflare Workers, AWS Lambda).
- You want to **merge our tool surface into an outer MCP
  gateway** that already serves multiple upstreams (auth at the
  edge, prefix-based routing, etc.).
- You want to dispatch a tool from **non-MCP code** — Vitest
  tests, queue workers, HITL operator UIs, scheduled jobs.

The toolset and `WhatsAppMcpServer` share the same per-tool
`{ definition, handler }` pairs internally; a drift detector
contract test pins them to identical surfaces on every PR.

## Quick reference

```ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppToolset } from "@dojocoding/whatsapp-mcp";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
});

const toolset = createWhatsAppToolset({
  client,
  wabaPhoneNumberId: client.phoneNumberId,
});

// 1) `tools/list` in your MCP gateway
const all = [...toolset.tools, ...otherUpstreamTools];

// 2) `tools/call` in your MCP gateway
const name = "whatsapp_send_text"; // from the MCP request
if (name.startsWith("whatsapp_")) {
  const result = await toolset.dispatch(name, args);
  return result; // CallToolResult — the same shape stdio returns
}

// 3) Resources + prompts work the same way
await toolset.readResource("whatsapp://templates");
await toolset.renderPrompt("wa-template-send", { templateName: "hello_world" });
```

## API

### `createWhatsAppToolset(input): WhatsAppToolset`

```ts
interface CreateToolsetInput {
  client: WhatsAppLikeClient;
  wabaPhoneNumberId: string;
  windowTracker?: WindowTracker;
  now?: () => number; // clock injection for the templates cache; test-only
}
```

### `WhatsAppToolset.tools: ReadonlyArray<ToolDefinition>`

Plain MCP `tools/list` entries — `{ name, title, description,
inputSchema, outputSchema, annotations? }`. The `inputSchema`
field is a zod **shape** (`Record<string, ZodTypeAny>`), the same
shape `McpServer.registerTool` accepts. Serialise to JSON Schema
with [`zod-to-json-schema`](https://www.npmjs.com/package/zod-to-json-schema)
if your gateway publishes JSON Schema directly.

### `WhatsAppToolset.resources: ReadonlyArray<ResourceDefinition>`

Two entries:

- `whatsapp://templates` — fixed URI; cached 60s.
- `whatsapp://window/{phone}` — URI template; resolves the
  24-hour window state when a `WindowTracker` is wired.

### `WhatsAppToolset.prompts: ReadonlyArray<PromptDefinition>`

One entry: `wa-template-send` — guided walkthrough for sending
an approved template.

### `dispatch(name, args, ctx?): Promise<CallToolResult>`

- Validates `args` against the tool's `inputSchema` (zod).
- On validation failure, returns `isError: true` with
  `structuredContent.error.code === "invalid_args"` and a
  per-field error tree under `details`.
- On unknown tool name, returns `isError: true` with
  `structuredContent.error.code === "unknown_tool"`.
- On a typed SDK error (`WindowClosedError`, `TemplateError`,
  `RateLimitError`, `AuthenticationError`, `PermissionError`,
  `CapabilityError`, `MissingCredentialsError`), returns
  `isError: true` with the canonical recovery hint that matches
  the stdio server byte-for-byte.
- On a non-SDK exception, propagates the throw — those are
  protocol / programmer errors, not model-recoverable.

`AuthenticationError` messages are redacted to a fixed string
to avoid leaking the bearer token through the MCP transcript.
This is identical to the stdio server's behaviour and is pinned
by the existing redaction contract test.

The optional `ctx?: DispatchContext`:

```ts
interface DispatchContext {
  requestId?: string; // for OTel correlation; generated UUID if omitted
  abortSignal?: AbortSignal; // forwarded to SDK transport
}
```

### `readResource(uri): Promise<ReadResourceResult>`

- `whatsapp://templates` → cached `client.listTemplates({ limit: 100 })` for 60 s.
- `whatsapp://window/<phone>` → reads the window tracker; without one wired, returns `isOpen: false` with a `notice` field.
- Anything else → returns an `error.code === "unknown_resource"` body.

### `renderPrompt(name, args?): Promise<GetPromptResult>`

- `wa-template-send` → guided walkthrough message.
- Anything else → returns a guidance message naming the
  unrecognised prompt; does not throw.

## Surface parity with `WhatsAppMcpServer`

The drift detector contract test
(`packages/whatsapp-mcp/test/contract/embedded-toolset-parity.test.ts`)
asserts on every PR that:

- The set of tool names exposed by both paths is identical.
- The set of resource URIs / URI templates is identical.
- The set of prompt names is identical.
- The JSON-Schema serialisation of each tool's `inputSchema`
  is byte-identical between paths.

This means: if you implement your gateway against the embedded
toolset today, and a future SDK release adds a new tool, the
new tool ships on both surfaces simultaneously. Renames will
fail CI before they reach you.

## Stability commitment

The toolset surface is **stable** under semver from
`@dojocoding/whatsapp-mcp@1.0.0` onwards (lands as `mcp-v0.4.0`
during the v1 runway). The MIGRATION guide covers the full
stability matrix; the short version:

- Tool names + resource URIs + prompt names → locked. Renames
  require a major bump.
- Tool `inputSchema`s → adding optional fields is non-breaking;
  making a field required / renaming / type-narrowing requires
  a major bump.
- Error response shape (`isError + structuredContent.error.{code, message, recoveryHint}`)
  → locked. New `code` values may be added (non-breaking); existing codes
  cannot be renamed without a major bump.

## When NOT to use the toolset

- **Claude Desktop, Cursor, Cline** — those hosts spawn the
  stdio bin directly. Use `dojo-whatsapp-mcp` from the
  `bin/` entry; don't embed.
- **Long-running standalone agent processes** — the stdio
  server's transport handles JSON-RPC framing, capability
  negotiation, and session lifecycle for you. Embedding only
  pays off when your outer runtime already implements that.

## See also

- [`docs/cookbook/mcp/embedded-toolset.md`](../cookbook/mcp/embedded-toolset.md)
  — end-to-end recipe wiring the toolset into a Next.js App
  Router MCP gateway with prefix-based routing.
- [`docs/mcp/tools.md`](./tools.md) — per-tool reference (same
  16 tools as the stdio surface).
- [`docs/mcp/error-recovery.md`](./error-recovery.md) — every
  `isError: true` shape and what the LLM should do next.
- [`MIGRATION.md`](../../MIGRATION.md) § "MCP server: 0.3.x →
  1.0.0" — stability matrix.
