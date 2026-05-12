# Design — Embedded toolset

## Context

The MCP server currently exposes its 16 tools, 2 resources, and
1 prompt only through a fully-wired `McpServer` instance bound
to a `Transport` (stdio in v1; eventually Streamable HTTP). The
internal flow is:

```
McpServer.tool(name, schema, handler)   ←  packages/whatsapp-mcp/src/tools/*.ts
McpServer.resource(name, uri, reader)   ←  packages/whatsapp-mcp/src/resources/*.ts
McpServer.prompt(name, schema, render)  ←  packages/whatsapp-mcp/src/prompts/*.ts
McpServer.connect(transport)            ←  packages/whatsapp-mcp/src/server.ts
```

This forces every consumer to either run our bin as a subprocess
(stdio) or wait for a transport that doesn't yet exist
(Streamable HTTP, planned for `mcp-v1.1.0`).

For consumers whose runtime can't host a long-lived stdio child
(Vercel serverless), or who want to merge our tool surface with
other upstreams in a single gateway, the only escape today is
to re-implement tool handlers — which immediately drifts from
our spec.

The embedded toolset exposes the same handlers as a flat,
callable API, with zero behavioural difference from the stdio
path. The MCP server class continues to exist and continues to
work; it's now a thin shell around the toolset.

## Goals

- Ship a public, supported API for consuming our 16 tools, 2
  resources, and 1 prompt from non-MCP-server callsites.
- Maintain a single source of truth for tool definitions and
  handlers — no duplicate registration logic.
- Make drift between "stdio surface" and "embedded surface"
  impossible at CI time.
- Preserve every existing invariant: no credentials in tool
  args, `isError: true` + structured error shape on failures,
  AuthenticationError redaction, etc.

## Non-Goals

- **Not in scope: HTTP transport.** The embedded toolset
  intentionally has no opinion about transport. Consumers wrap
  it in whatever HTTP layer they own.
- **Not in scope: multi-WABA.** Each `WhatsAppToolset`
  instance speaks for one `WhatsAppLikeClient`. Multi-WABA
  consumers create N toolsets, one per WABA-phone pair —
  identical to the stdio "one server per pair" pattern.
- **Not in scope: streaming.** Tool dispatch is request /
  response. Streaming responses ride on the future Streamable
  HTTP transport, not the toolset API.

## Decisions

### 1. Why `dispatch` instead of method-per-tool

The toolset exposes a single `dispatch(name, args)` method
rather than `toolset.sendText(args)`. Two reasons:

- **Mirrors the MCP protocol shape.** Consumers wiring this
  into an outer gateway are already routing JSON-RPC by name;
  matching the protocol shape removes a translation step.
- **Type safety doesn't degrade.** The `tools` array is fully
  typed; consumers who want per-tool type safety can write
  `for (const tool of toolset.tools) { ... }` and TypeScript
  narrows each handler's input.

A typed `client` wrapper that exposes per-tool methods is a
sibling problem — that's what the SDK's `WhatsAppClient`
already is.

### 2. Why `WhatsAppLikeClient`, not `WhatsAppClient`

`createWhatsAppToolset` takes a `WhatsAppLikeClient` so consumers
can pass in:

- The real `WhatsAppClient` (production).
- The `MockWhatsAppClient` (tests, preview).
- A wrapped client (e.g. `withRateLimit(client, ...)` for the
  Site2Print orchestrator pattern).
- A custom wrapper enforcing consent policy, audit logging,
  etc.

This matches every other SDK consumption point. The toolset
makes zero assumptions about HTTP transport, retry policy, or
window tracking beyond what `WhatsAppLikeClient` exposes.

### 3. Why `windowTracker` is forwarded separately

The SDK's `WhatsAppClient` accepts an optional `windowTracker`
in its constructor. The toolset accepts one too because some
tool handlers (e.g. `whatsapp://window/{phone}` resource) need
to query window state without going through the client. When
omitted, the resource returns `isOpen: false` (matches the
stdio server's current behaviour when no tracker is wired).

### 4. Resource + prompt shape

Resources and prompts are exposed identically to tools — flat
arrays of definitions + per-name reader/renderer methods
(`readResource(uri)`, `renderPrompt(name, args)`). Same
drift-detection treatment.

### 5. Refactor strategy: per-tool `{definition, handler}` exports

Each tool file currently exports a name constant and inlines the
zod schema + handler inside an MCP server registration call. The
refactor splits this into:

```ts
// before (conceptual)
server.tool(SEND_TEXT_TOOL_NAME, sendTextSchema, async (args) => { ... });

// after
export const SEND_TEXT_TOOL: ToolDefinition = {
  name: "whatsapp_send_text",
  description: "...",
  inputSchema: sendTextSchema,
};
export async function handleSendText(
  client: WhatsAppLikeClient,
  args: z.infer<typeof sendTextSchema>,
  ctx: DispatchContext
): Promise<CallToolResult> { ... }
```

`WhatsAppMcpServer` then consumes the same `{ SEND_TEXT_TOOL,
handleSendText }` pair via a tiny adapter. The handler
signature is intentionally identical between the two paths so
drift is impossible.

### 6. Error mapping stays centralised

`src/errors.ts`'s `mapSdkError` + `withErrorMapping` continue
to be the single point of conversion from SDK error → MCP
`CallToolResult`. The toolset's `dispatch` uses the same
helpers as the stdio server. Same recovery hints, same
redaction.

### 7. `DispatchContext`

The optional third parameter to `dispatch(name, args, ctx?)`
carries cross-cutting context that wasn't in the args:

```ts
interface DispatchContext {
  requestId?: string;        // for OTel correlation
  abortSignal?: AbortSignal; // for request cancellation
}
```

When omitted, dispatch generates a UUID for the request id
(matches the stdio server's current behaviour).

### 8. Future: streaming responses

When Streamable HTTP lands in `mcp-v1.1.0`, server-initiated
notifications (resource updates, partial results) require a
streaming response shape that doesn't fit `Promise<CallToolResult>`.
The toolset API may grow an optional streaming variant then —
`dispatchStreaming(name, args, ctx)`. It's deliberately not in
v1; we'll see real consumer demand first.
