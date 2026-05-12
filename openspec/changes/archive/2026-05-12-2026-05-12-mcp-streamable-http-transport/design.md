# Design — Streamable HTTP transport + bearer auth

## Context

`@dojocoding/whatsapp-mcp@0.4.0` ships three consumption
surfaces:

1. **Stdio bin** (`dojo-whatsapp-mcp`) — Claude Desktop, Cursor,
   Cline, Claude Agent SDK spawn-style hosts.
2. **Programmatic embedding** (`WhatsAppMcpServer.connect(transport)`)
   — consumers wrapping the server with a custom transport.
3. **Embedded toolset** (`createWhatsAppToolset`) — bypasses MCP
   transport entirely; flat dispatch from outer gateways.

What's missing: a turn-key HTTP path for consumers who want
real MCP protocol semantics over HTTP without writing their
own transport class. The MCP SDK ships
`WebStandardStreamableHTTPServerTransport` (Fetch-API native,
runs on Workers / Vercel / Bun / Deno / Node 18+ unmodified)
which makes this a small wiring exercise — not a from-scratch
transport implementation.

This change adds a fourth surface: `createWhatsAppHttpHandler`.
A factory that builds a fully-wired transport + server + auth
pipeline and returns a single `(req: Request) => Promise<Response>`
handler.

## Goals

- Ship MCP Streamable HTTP support so consumers without a
  long-lived process (Vercel / Workers / Lambda /
  claude.ai web connectors) can host the WhatsApp MCP surface.
- Make auth a first-class option, not a bolt-on. Two modes:
  static shared-secret (defence-in-depth or closed-network);
  callback-based verifier for OAuth 2.1 / Resource Server
  integration.
- Preserve surface parity with stdio + embedded toolset —
  same 16 tools, same schemas, same recovery hints.
- Zero changes to the existing stdio path. The MCP bin still
  works exactly as before.

## Non-Goals

- **OAuth 2.1 dance implementation.** The handler accepts an
  already-verified bearer (via the `verifyToken` callback);
  it does not implement the OAuth flows. Token validation /
  introspection / rotation is the caller's concern. This
  matches the MCP SDK's own auth model.
- **Distributed session store.** Stateful mode is supported
  but sessions live in-memory in the transport. Multi-node
  deployments needing shared sessions must either run in
  stateless mode (default) or provide their own
  session-store integration outside this handler.
- **Streamable HTTP client.** The MCP SDK already ships a
  Streamable HTTP **client** transport for consumers building
  MCP clients. This change is server-side only.
- **DNS-rebinding protection.** Per the MCP SDK's own
  `@deprecated` markers, allowed-hosts / allowed-origins
  validation is being moved out of the transport. Consumers
  needing it wire their own middleware before our handler.

## Decisions

### 1. Why one factory, not a class

The handler closure captures (a) the SDK client (b) the MCP
server instance (c) the transport (d) the auth config. A
class would expose mutators that don't make sense — once
configured, the handler is immutable. A factory returning a
function is the smaller surface.

### 2. Why stateless by default

Stateful sessions in the MCP transport hold per-session state
in-memory in the transport object. Two failure modes for
serverless:

- **Cold start**: each invocation gets a fresh transport
  instance → sessions don't survive.
- **Multi-node**: load-balanced functions don't share session
  state → client gets a "session not found" 404 on the second
  request that lands on a different node.

The default avoids both. Consumers who genuinely want
stateful sessions (long-lived Node / Bun servers) opt in via
`stateless: false`.

### 3. Why a single transport instance per handler, not per request

The MCP SDK's transport class is designed to be shared. In
stateless mode it has no per-session state; in stateful mode
the shared state is the point. Constructing one transport
per request would be wasteful and break stateful mode.

### 4. Why two auth modes, not one

Two real consumer shapes:

- **Closed network / inner-gateway deployments.** A static
  shared secret rotated out-of-band suffices. Constant-time
  compare is one line; no need to involve OAuth.
- **Public-internet exposure.** Real bearer tokens with
  validation. Caller-supplied `verifyToken` because token
  validation depends on the consumer's identity provider —
  we don't know if it's Auth0, Cognito, custom JWTs, etc.

Both optional. Neither set = no auth at this layer.
Documented as a gateway concern; consumers without an outer
gateway must set at least one.

### 5. Why constant-time compare for the static token

A timing-safe compare is one line via Web Crypto
(`crypto.subtle.timingSafeEqual` isn't available; manual
constant-time XOR is the portable pattern). Avoids timing
attacks that distinguish "right prefix wrong suffix" from
"wrong entirely." Worth the line.

### 6. Why 401 carries a JSON-RPC error body, not a bare status

MCP clients expect every response to be valid JSON-RPC. A
bare 401 with no body confuses some clients. Returning:

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "error": {
    "code": -32001,
    "message": "Unauthorized"
  }
}
```

with `Content-Type: application/json` keeps clients happy
while still emitting the 401 status. Code `-32001` is the
JSON-RPC reserved error range for transport-level failures.

### 7. Why `AuthInfo` is re-exported

The MCP SDK lives at `@modelcontextprotocol/sdk/server/auth/types.js`
— a deep path that's awkward for consumers. Re-exporting from
the package root `@dojocoding/whatsapp-mcp` keeps the consumer
surface flat.

### 8. Why not bundle JWT validation in the SDK

The `verifyToken` callback shape leaves JWT validation to
the consumer. We could ship a built-in JWKS-fetching verifier
— but:

- It would pull in JWT-library dependencies, blowing up bundle
  size for consumers who don't need it.
- It commits us to a particular library choice (`jose` vs
  `jsonwebtoken` vs custom WebCrypto) that's better as a
  consumer concern.
- Real-world auth needs (audience check, issuer check,
  scope-based authz beyond bearer validity) are too
  per-deployment.

The callback shape is the right primitive. We'll document
canonical JWT verifier patterns in the cookbook
(`docs/cookbook/mcp/streamable-http-vercel.md`) using
`jose` — but as a code recipe, not a bundled dependency.

### 9. Why DNS-rebinding protection is not in our surface

The MCP SDK deprecates `allowedHosts` / `allowedOrigins`
options on the transport in favour of external middleware.
Carrying them through our surface would lock us to a
deprecated path. Consumers needing DNS-rebinding protection
add a CORS / Host-header check before our handler — one line
in any web framework.

### 10. Surface-parity drift detection

The existing
`packages/whatsapp-mcp/test/contract/embedded-toolset-parity.test.ts`
already compares the toolset against the stdio server. This
change extends it (or adds a sibling) that boots the HTTP
handler in-process, hits it with an `InMemoryTransport`-like
client via real Fetch round-trip (using `undici`'s built-in
fetch against an in-process `globalThis.fetch` proxy that
short-circuits to `handler(req)`), and asserts the same tool
names + resource URIs + prompt names appear.

The proof is byte-identical surface parity. Adding a tool to
one path without the other fails CI immediately.

### 11. Bundle size impact

`WebStandardStreamableHTTPServerTransport` is part of
`@modelcontextprotocol/sdk` which is already a dependency.
The new `src/http.ts` is ~150 lines of glue. Bundle growth
should be <2 KB brotlied — well under the 200 KB library
budget.

### 12. Migration / coexistence with the existing transport surface

Consumers can use any combination of:

- Stdio bin (`dojo-whatsapp-mcp` from npx) — unchanged.
- Embedded toolset (`createWhatsAppToolset`) — unchanged from
  v0.4.0.
- HTTP handler (`createWhatsAppHttpHandler`) — new.

All three consume the same `WhatsAppLikeClient`; multi-WABA
deployments still run N instances of whichever surface they
prefer.
