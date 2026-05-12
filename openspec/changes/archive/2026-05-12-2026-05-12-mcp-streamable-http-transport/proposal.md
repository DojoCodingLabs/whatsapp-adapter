# Change proposal — Streamable HTTP transport + bearer auth for `@dojocoding/whatsapp-mcp`

## Why

`@dojocoding/whatsapp-mcp@0.4.0` ships stdio-only.
[`docs/mcp/transports.md`](../../../docs/mcp/transports.md)
already documents Streamable HTTP as the planned v2 transport;
the audit ranked it Phase B because most current MCP hosts
(Claude Desktop, Cursor, Cline, the Claude Agent SDK) speak
stdio. But a growing set of consumers can't run stdio at all:

- **Vercel serverless / Cloudflare Workers / AWS Lambda** — no
  long-lived process to host a stdio child.
- **claude.ai web custom connectors** — only speak HTTP.
- **Site2Print's `/api/mcp` gateway** — already speaks HTTP
  with its own OAuth at the edge; sidestepped this gap via the
  embedded toolset (A1) but other consumers without an outer
  gateway still need a turn-key HTTP path.

This change ships `createWhatsAppHttpHandler({ ... }): (req: Request) => Promise<Response>`
— a Fetch-API native handler implementing MCP Streamable HTTP
(spec revision `2025-06-18`). Mountable on Next.js App Router
route handlers, Cloudflare Workers `fetch`, Hono `app.all`,
Bun `Bun.serve`, Deno `Deno.serve`, or wrapped via Express
middleware. Same 16 tools / 2 resources / 1 prompt as the
stdio path; surface parity drift-detected at CI.

Auth is built-in through two complementary modes:

- **Static bearer** — `staticToken: string`. Single shared
  secret matched via constant-time compare against
  `Authorization: Bearer <token>`. Right for closed-network
  deployments and gateways with their own outer auth that
  want a defence-in-depth check on this handler.
- **Verifier callback** — `verifyToken: (token, req) => Promise<AuthInfo | null>`.
  Caller-supplied; returns the MCP-SDK `AuthInfo` shape for
  the message handlers to consume (or `null` to reject). This
  is the OAuth 2.1 / OAuth Resource Server (MCP spec
  revision `2025-06-18`) integration point.

Both optional. If neither is supplied, the handler accepts
every request — appropriate when the outer gateway has
already authenticated.

## What Changes

### New public surface on `@dojocoding/whatsapp-mcp`

- **NEW** `createWhatsAppHttpHandler(input: CreateWhatsAppHttpHandlerInput): WhatsAppHttpHandler`
- **NEW** `CreateWhatsAppHttpHandlerInput`:
  ```ts
  interface CreateWhatsAppHttpHandlerInput {
    client: WhatsAppLikeClient;
    wabaPhoneNumberId: string;
    windowTracker?: WindowTracker;
    serverVersion?: string;
    /** Process-wide MCP session generator. Defaults to randomUUID. */
    sessionIdGenerator?: () => string;
    /** Stateless mode (no session tracking). Defaults to false. */
    stateless?: boolean;
    /** Static shared-secret bearer. Mutually compatible with verifyToken. */
    staticToken?: string;
    /** Verifier callback; returns AuthInfo to consume, or null to 401. */
    verifyToken?: (token: string, req: Request) => Promise<AuthInfo | null>;
  }
  ```
- **NEW** `WhatsAppHttpHandler = (req: Request) => Promise<Response>`.
- **NEW** re-export of `AuthInfo` from the MCP SDK's auth types
  so consumers writing a `verifyToken` callback don't have to
  import deep paths.

### Internal — `src/http.ts`

Wires:

1. `buildServer(...)` from `src/server.ts` (existing — same
   tool/resource/prompt registration as stdio).
2. `new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator? })`
   from `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`.
3. `server.connect(transport)` once at handler-construction time.
4. The returned closure performs auth pre-checks, then
   delegates to `transport.handleRequest(req, { authInfo })`.

The transport is shared across requests at the handler-closure
level. In stateless mode, no per-request state collides; in
stateful mode (off by default) sessions persist across the
process lifetime — appropriate for long-lived Node / Bun /
Deno servers; not appropriate for serverless without an
external session store (sessions live in-memory).

### Auth wiring

Authorization is checked BEFORE delegating to the MCP transport:

```
1. Extract `Authorization: Bearer <token>` from the request.
   - If absent AND `staticToken` is set OR `verifyToken` is set → 401.
   - If absent AND neither auth option is set → pass through.

2. If `verifyToken` is set:
   - Call `verifyToken(token, req)`.
   - If returns null → 401.
   - If returns AuthInfo → pass to transport.handleRequest({ authInfo }).

3. Else if `staticToken` is set:
   - Constant-time compare against the supplied token.
   - If mismatch → 401.

4. Delegate to transport.handleRequest(req, { authInfo }).
```

`401` responses carry a JSON-RPC-shaped error body so MCP
clients see a typed error (not just a bare HTTP status).

### Surface parity

The new HTTP handler exposes the same 16 tool names, 2
resource URIs, and 1 prompt name as `WhatsAppMcpServer` and
`createWhatsAppToolset`. Surface parity is drift-detected by
extending the existing
`packages/whatsapp-mcp/test/contract/embedded-toolset-parity.test.ts`
to also assert against the HTTP path.

### Docs

- New page `docs/mcp/http.md` — when to use the HTTP handler,
  Next.js / Workers / Hono / Express recipes, the two auth
  modes, the JSON-RPC error shape for 401s.
- New cookbook `docs/cookbook/mcp/streamable-http-vercel.md` —
  end-to-end Vercel Functions recipe with a JWT verifier
  callback wired into `verifyToken`.
- `docs/mcp/transports.md` updated — Streamable HTTP moves
  from "🔮 Planned (v2)" to "✅ Shipped (v1.1)".

## Impact

- **mcp-server capability:** 3× ADDED requirements (the
  Streamable HTTP transport surface, the two auth modes, and
  the surface-parity invariant extended to cover HTTP).
- **Release impact:** ships as part of `mcp-v1.1.0`. Lands on
  `main` ahead of the v1 stability tag so Site2Print + other
  early adopters can exercise it.
- **Stability:** `createWhatsAppHttpHandler`, the AuthInfo
  re-export, and the surface-parity invariant are locked under
  semver from `mcp-v1.0.0` onwards (the handler is added in
  v1.1 — additive minor, non-breaking).
- **Breaking?** No. Stdio surface is unchanged; embedded
  toolset is unchanged; the HTTP handler is a brand-new
  third consumption surface.
