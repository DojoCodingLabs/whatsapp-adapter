## ADDED Requirements

### Requirement: Streamable HTTP handler

The package SHALL export `createWhatsAppHttpHandler(input)`
returning a Fetch-API native handler with shape
`(req: Request) => Promise<Response>`. The handler SHALL
implement MCP Streamable HTTP per spec revision
`2025-06-18` by delegating to the MCP SDK's
`WebStandardStreamableHTTPServerTransport`.

The factory's input SHALL accept:

- `client: WhatsAppLikeClient` (required).
- `wabaPhoneNumberId: string` (required).
- `windowTracker?: WindowTracker` (optional).
- `serverVersion?: string` (optional override for the MCP
  handshake `serverInfo.version`).
- `sessionIdGenerator?: () => string` (optional; defaults
  to a cryptographically secure UUID v4).
- `stateless?: boolean` (optional; defaults to `true`).
- `staticToken?: string` (optional; see auth requirement).
- `verifyToken?: (token, req) => Promise<AuthInfo | null>`
  (optional; see auth requirement).

The returned handler SHALL be mountable on any runtime
supporting the Fetch API: Cloudflare Workers, Vercel
Functions (Node + Edge), AWS Lambda (Web Adapter), Hono,
Next.js App Router, Bun, Deno, plain Node 18+.

The handler SHALL be safe to share across concurrent requests
in both stateless and stateful modes — the underlying
transport handles per-request and per-session state
internally.

The 16 tool names, 2 resource URIs, and 1 prompt name
exposed by the HTTP handler SHALL be byte-identical to the
stdio `WhatsAppMcpServer` and the embedded
`createWhatsAppToolset`. The JSON-Schema serialisation of
each tool's `inputSchema` SHALL be byte-identical across all
three surfaces. Parity SHALL be enforced by a contract test
that runs on every PR.

#### Scenario: HTTP handler responds to MCP initialize

- **GIVEN** a handler built with `createWhatsAppHttpHandler({ client, wabaPhoneNumberId })`
- **WHEN** a JSON-RPC `initialize` request is POSTed to the handler
- **THEN** the response SHALL be 200
- **AND** the response body SHALL be a JSON-RPC result containing `serverInfo.name = "@dojocoding/whatsapp-mcp"` and capability sets for tools, resources, and prompts

#### Scenario: HTTP handler tools/list matches stdio + toolset

- **WHEN** `tools/list` is invoked via the HTTP handler
- **THEN** the returned tool-name set SHALL be byte-identical to the set registered on `WhatsAppMcpServer` and exposed via `createWhatsAppToolset`

#### Scenario: HTTP handler tools/call round-trips a mock send

- **GIVEN** a handler built with a `MockWhatsAppClient`
- **WHEN** `tools/call whatsapp_send_text` is invoked with `{ to: "+5210000000001", body: "x" }`
- **THEN** the response SHALL include `structuredContent.messageId` matching `/^wamid\.mock-\d+/`

#### Scenario: Surface-parity drift fails CI

- **WHEN** a developer adds a 17th tool to `createWhatsAppToolset` but not to `WhatsAppMcpServer` or the HTTP handler
- **THEN** the parity contract test SHALL fail with a diff naming the missing tool on the affected surface

### Requirement: Bearer authentication on the HTTP handler

The HTTP handler SHALL support two bearer-authentication
modes via the factory input. Both are optional. When neither
is supplied, the handler SHALL pass every request through
to the transport (delegating authentication to the outer
gateway).

**Static token mode.** When `staticToken: string` is supplied:

- The handler SHALL extract the `Authorization: Bearer <token>`
  header from each request.
- The handler SHALL compare the token against `staticToken`
  using a constant-time byte-wise comparison (no early-exit
  on first mismatch).
- On mismatch OR missing header, the handler SHALL return a
  `401` response.

**Verifier callback mode.** When `verifyToken: (token, req) => Promise<AuthInfo | null>`
is supplied:

- The handler SHALL extract the bearer.
- The handler SHALL invoke `verifyToken(token, req)`.
- A `null` return value SHALL produce a `401`.
- A non-null return value SHALL be passed verbatim as
  `authInfo` to `transport.handleRequest`, making it
  available to message handlers via the MCP SDK's auth
  surface.

**Precedence.** When both `staticToken` and `verifyToken` are
supplied, `verifyToken` SHALL take precedence; `staticToken`
SHALL be ignored.

**401 response shape.** Every `401` response SHALL carry a
JSON-RPC-shaped body:

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "error": { "code": -32001, "message": "Unauthorized" }
}
```

with `Content-Type: application/json`. The body SHALL NOT
echo the rejected token or any portion of it. The body
SHALL NOT vary in a way that distinguishes "wrong static
token" from "verifyToken returned null" from "no
Authorization header" — clients SHOULD not be able to infer
why authentication failed from the response body alone.

The MCP SDK `AuthInfo` type SHALL be re-exported from
`@dojocoding/whatsapp-mcp` so consumer code writing a
`verifyToken` callback can import the shape from the
package root.

#### Scenario: Static token match passes through

- **GIVEN** a handler built with `{ staticToken: "secret-1" }`
- **WHEN** a request arrives with `Authorization: Bearer secret-1`
- **THEN** the handler SHALL delegate to the underlying transport
- **AND** the response SHALL NOT be `401`

#### Scenario: Static token mismatch returns 401

- **GIVEN** a handler built with `{ staticToken: "secret-1" }`
- **WHEN** a request arrives with `Authorization: Bearer wrong-token`
- **THEN** the response SHALL be `401`
- **AND** the response body SHALL be `{ jsonrpc, id: null, error: { code: -32001, message: "Unauthorized" } }`

#### Scenario: verifyToken returning null returns 401

- **GIVEN** a handler built with `{ verifyToken: async () => null }`
- **WHEN** any request arrives
- **THEN** the response SHALL be `401`
- **AND** `transport.handleRequest` SHALL NOT be invoked

#### Scenario: verifyToken returning AuthInfo passes through with auth context

- **GIVEN** a handler built with `verifyToken` returning `{ token, clientId, scopes: ["whatsapp.send"] }`
- **WHEN** a request arrives with a valid bearer
- **THEN** the handler SHALL delegate to `transport.handleRequest` with the returned `AuthInfo`
- **AND** the response SHALL NOT be `401`

#### Scenario: Both auth modes set — verifyToken takes precedence

- **GIVEN** a handler with both `staticToken` and `verifyToken` set, where `staticToken` would match the incoming token but `verifyToken` returns `null`
- **WHEN** the request arrives
- **THEN** the response SHALL be `401` (verifyToken's `null` wins)

#### Scenario: No auth set passes through

- **GIVEN** a handler built with neither `staticToken` nor `verifyToken`
- **WHEN** any request arrives, with or without an Authorization header
- **THEN** the handler SHALL delegate to the underlying transport
- **AND** the response SHALL NOT be `401`

### Requirement: HTTP handler runtime portability

The HTTP handler SHALL run unmodified on every runtime
supporting the Web Standards Fetch API: Cloudflare Workers,
Vercel Functions (Node + Edge), AWS Lambda (with the AWS
Lambda Web Adapter), Hono, Next.js App Router, Bun, Deno,
plain Node 18+.

The handler SHALL NOT use any Node-API-only globals
(`process`, `Buffer`, `node:crypto` direct imports without
the web equivalent fallback). All cryptographic operations
SHALL use Web Crypto.

The handler SHALL be safe to construct at module scope and
reuse across concurrent requests in stateless mode.

#### Scenario: Handler runs on Cloudflare Workers without modification

- **GIVEN** a handler built and exported as the Worker's `fetch` function
- **WHEN** a request hits the Worker
- **THEN** the handler SHALL respond without any Node-API-only function being invoked
- **AND** the response SHALL conform to the MCP Streamable HTTP spec

#### Scenario: Handler runs on Vercel Functions (Node runtime)

- **GIVEN** a handler exported from a Next.js App Router route handler with `export const runtime = "nodejs"`
- **WHEN** a request hits the route
- **THEN** the handler SHALL respond correctly
- **AND** subsequent requests in the same warm function SHALL reuse the same handler closure (transport + server instance shared)
