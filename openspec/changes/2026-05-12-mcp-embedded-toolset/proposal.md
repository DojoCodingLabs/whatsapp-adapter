# Change proposal — Embedded toolset on `@dojocoding/whatsapp-mcp`

## Why

Site2Print runs an MCP gateway at `/api/mcp` on Vercel serverless.
Their gateway already implements OAuth 2.1 + PKCE + JWT, dispatches
to multiple upstream toolsets (Alegra ~78 tools + Dojo's 16), and
needs to merge our tool definitions into a single `tools/list`
response routed by `wa_*` prefix. The current shape of
`@dojocoding/whatsapp-mcp` forces consumers to instantiate a full
`McpServer` and a transport, which:

- Requires a long-lived process (incompatible with Vercel's
  serverless function lifecycle).
- Makes it impossible to merge tools into an outer gateway's
  surface — tool dispatch is hidden behind the MCP SDK's
  `Server.connect(transport)` plumbing.
- Forces consumers to write boilerplate just to invoke a single
  tool from non-MCP code (Vitest test suites, queue workers,
  HITL operator UIs).

A flat **embedded toolset** API solves all three. The MCP server
process itself uses the same primitives internally, so there's
zero behavioural drift between "use the bin via Claude Desktop"
and "embed the toolset in your own gateway."

This was explicitly identified by Site2Print as the single
biggest unlock for their integration — more important than
shipping our own Streamable HTTP transport. It sidesteps the
transport question entirely: consumers who run on serverless
ship our toolset inside their existing HTTP layer, with their
existing auth.

## What Changes

### New public surface on `@dojocoding/whatsapp-mcp`

- **NEW** `createWhatsAppToolset(input: CreateToolsetInput): WhatsAppToolset`
  — top-level factory exported from `@dojocoding/whatsapp-mcp`.
- **NEW** `CreateToolsetInput`:
  ```ts
  interface CreateToolsetInput {
    client: WhatsAppLikeClient;           // SDK client (real or mock)
    windowTracker?: WindowTracker;        // forwarded to dispatch context
    logger?: McpLogger;                   // optional structured logger
  }
  ```
- **NEW** `WhatsAppToolset`:
  ```ts
  interface WhatsAppToolset {
    readonly tools: ReadonlyArray<ToolDefinition>;
    readonly resources: ReadonlyArray<ResourceDefinition>;
    readonly prompts: ReadonlyArray<PromptDefinition>;
    dispatch(name: string, args: unknown, ctx?: DispatchContext): Promise<CallToolResult>;
    readResource(uri: string): Promise<ReadResourceResult>;
    renderPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult>;
  }
  ```
- **NEW** `ToolDefinition` / `ResourceDefinition` / `PromptDefinition`
  types — plain MCP `tool` / `resource` / `prompt` shape per
  the MCP spec, importable without instantiating a server.

### Internal refactor (zero behavioural change)

Each file under `packages/whatsapp-mcp/src/tools/*.ts` already
co-locates a zod `inputSchema`, a handler function, and a name
constant. The refactor splits each tool's exported surface into
an `Anchored` shape:

```ts
export const SEND_TEXT_TOOL: ToolDefinition = { name, description, inputSchema };
export async function handleSendText(client, args, ctx): Promise<CallToolResult> { ... }
```

`WhatsAppMcpServer.register()` then consumes the same
`{definition, handler}` pairs the embedded toolset does. The
public surface of `WhatsAppMcpServer` is unchanged.

### Drift detection

A new contract test
`packages/whatsapp-mcp/test/contract/embedded-toolset-parity.test.ts`
asserts byte-for-byte equality between:

- The 16 tool names exposed by `createWhatsAppToolset(...).tools`
- The 16 tool names registered on a `WhatsAppMcpServer` instance

Same for resources and prompts. Renaming a tool in one path
without the other now fails CI.

### Docs

- New page `docs/mcp/embedded.md` documenting the toolset API,
  when to use it (gateway integration, non-MCP callsites), and
  the byte-identical-surface guarantee vs the stdio server.
- New cookbook `docs/cookbook/mcp/embedded-toolset.md` with a
  Next.js App Router gateway example merging our tools alongside
  another upstream.

## Impact

- **mcp-server capability:** 2× ADDED requirements (embedded
  toolset API + surface-parity invariant). The existing 10
  stdio-related requirements are unchanged.
- **No SDK changes.** The toolset consumes the SDK as a
  `WhatsAppLikeClient` consumer; no SDK surface is touched.
- **Release impact:** ships as `mcp-v0.4.0` (minor, additive).
- **Stability:** the embedded toolset surface is part of the v1
  stability commitment — locked under semver from `mcp-v1.0.0`
  onwards.
