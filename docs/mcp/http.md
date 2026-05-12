# Streamable HTTP handler — `createWhatsAppHttpHandler`

A Fetch-API native MCP Streamable HTTP handler. Mountable on
any Web-Standards runtime: Cloudflare Workers, Vercel Functions
(Node + Edge), AWS Lambda (Web Adapter), Hono, Next.js App
Router, Bun, Deno, plain Node 18+.

Built-in bearer authentication via two modes:

- **Static shared-secret** — `staticToken: string`. Constant-time
  compare against `Authorization: Bearer <token>`.
- **Verifier callback** — `verifyToken: (token, req) => Promise<AuthInfo | null>`.
  Consumer-supplied; returns the MCP-SDK `AuthInfo` shape on
  success, `null` to reject.

Both optional. Pass neither to delegate authentication entirely
to your outer gateway.

Same 16 tools / 2 resources / 1 prompt as the stdio bin and the
embedded toolset; surface parity drift-detected at CI.

## When to use the HTTP handler

| Runtime                                            | Recommended consumption surface                                                                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Desktop / Cursor / Cline / Claude Agent SDK | **stdio bin** (`dojo-whatsapp-mcp` via `npx`). Hosts spawn child processes; HTTP handler is overkill.                                                                   |
| Long-lived Node / Bun / Deno server                | **stdio bin** OR **HTTP handler** (your call). Embedded toolset if you're merging with other upstreams.                                                                 |
| Vercel Functions / Cloudflare Workers / AWS Lambda | **HTTP handler** — no long-lived process; embedded toolset if you have an outer gateway with its own MCP protocol layer.                                                |
| `claude.ai` web custom connectors                  | **HTTP handler.** Public HTTPS endpoint required.                                                                                                                       |
| Outer MCP gateway merging multiple upstreams       | **Embedded toolset** (`createWhatsAppToolset`). The HTTP handler implements the MCP protocol layer for you; the toolset gives you the tools without the protocol layer. |

The three consumption surfaces share the same 16 tools / 2
resources / 1 prompt — a tool name added to one is added to all
three (parity drift-detected at CI). Pick by your runtime
constraints; don't worry about the consumer-side surface.

## Quick reference

```ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHttpHandler } from "@dojocoding/whatsapp-mcp";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
});

const handler = createWhatsAppHttpHandler({
  client,
  wabaPhoneNumberId: client.phoneNumberId,
  staticToken: process.env.MCP_GATEWAY_TOKEN!, // simple shared-secret auth
});

// Mount per your runtime:
// - Cloudflare Workers: export default { fetch: handler };
// - Next.js App Router: export { handler as GET, handler as POST, handler as DELETE };
// - Hono: app.all("/mcp", (c) => handler(c.req.raw));
// - Bun: Bun.serve({ port: 3000, fetch: handler });
```

## API

### `createWhatsAppHttpHandler(input): WhatsAppHttpHandler`

```ts
interface CreateWhatsAppHttpHandlerInput {
  client: WhatsAppLikeClient;
  wabaPhoneNumberId: string;
  windowTracker?: WindowTracker;
  serverVersion?: string;
  sessionIdGenerator?: () => string; // stateful mode only; defaults to crypto.randomUUID()
  stateless?: boolean; // default true
  staticToken?: string; // shared-secret bearer
  verifyToken?: (token: string, req: Request) => Promise<AuthInfo | null>;
}

type WhatsAppHttpHandler = (req: Request) => Promise<Response>;
```

Safe to construct at module scope. Safe to reuse the returned
handler across concurrent requests in both stateless and
stateful modes.

### Stateless vs stateful

**Stateless (default):** every request is independent. No
session tracking. Right for serverless deployments where
function instances cannot share state. The handler builds a
fresh MCP server + transport pair per request — cheap (~ms
each), entirely safe.

**Stateful (opt-in via `stateless: false`):** the MCP SDK
tracks sessions in-memory keyed by the `Mcp-Session-Id`
header. The handler shares one server + transport across
requests. Right for long-lived Node / Bun / Deno servers
where session continuity matters. **Not** safe across
multi-node deployments without an external session store —
the in-memory state lives in one process only.

### Auth pipeline

The handler evaluates auth in this order on every request:

1. If neither `staticToken` nor `verifyToken` is set — pass
   the request to the transport unchanged. (You're trusting
   your outer gateway.)
2. Extract `Authorization: Bearer <token>` (scheme prefix
   case-insensitive per RFC 6750 §2.1). Missing header on
   auth-required path → 401.
3. If `verifyToken` is set, invoke it. `null` return → 401.
   Non-null `AuthInfo` is passed verbatim to
   `transport.handleRequest({ authInfo })` for the message
   handlers to consume.
4. Else if `staticToken` is set, constant-time compare against
   the supplied secret. Mismatch → 401.
5. On match (or when auth isn't required), delegate to
   `transport.handleRequest(req, { authInfo })`.

When **both** `staticToken` and `verifyToken` are supplied,
`verifyToken` takes precedence; `staticToken` is ignored.

### 401 response shape

Every 401 response carries a JSON-RPC error body:

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "error": { "code": -32001, "message": "Unauthorized" }
}
```

with `Content-Type: application/json`. The body does **not**
vary across the three "auth failed" paths (missing header /
bad static token / verifyToken returned null) — clients
cannot infer the failure cause from the body alone, and the
body never echoes the rejected token.

## Recipes

### Next.js App Router on Vercel

```ts
// app/api/mcp/route.ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHttpHandler } from "@dojocoding/whatsapp-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
});

const handler = createWhatsAppHttpHandler({
  client,
  wabaPhoneNumberId: client.phoneNumberId,
  staticToken: process.env.MCP_GATEWAY_TOKEN!,
});

export { handler as GET, handler as POST, handler as DELETE };
```

For an OAuth-style verifier callback with JWT verification
(jose, audience + issuer checks, scope-based authz), see
[`docs/cookbook/mcp/streamable-http-vercel.md`](../cookbook/mcp/streamable-http-vercel.md).

### Cloudflare Workers

```ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHttpHandler } from "@dojocoding/whatsapp-mcp";

interface Env {
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_BUSINESS_ACCOUNT_ID: string;
  WHATSAPP_APP_SECRET: string;
  MCP_GATEWAY_TOKEN: string;
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    const handler = createWhatsAppHttpHandler({
      client: new WhatsAppClient({
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        token: env.WHATSAPP_ACCESS_TOKEN,
        appSecret: env.WHATSAPP_APP_SECRET,
      }),
      wabaPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      staticToken: env.MCP_GATEWAY_TOKEN,
    });
    return handler(req);
  },
};
```

Workers don't preserve state between invocations the same way
Node servers do, but the handler is allocated per-fetch in
this pattern — cheap enough. For warm-invocation reuse, hoist
the handler construction to module scope.

### Hono

```ts
import { Hono } from "hono";

import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHttpHandler } from "@dojocoding/whatsapp-mcp";

const app = new Hono();
const handler = createWhatsAppHttpHandler({
  client: new WhatsAppClient({
    /* ... */
  }),
  wabaPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  staticToken: process.env.MCP_GATEWAY_TOKEN!,
});

app.all("/mcp", (c) => handler(c.req.raw));

export default app;
```

### Express (wrapped via Web-Standards adapter)

Express talks Node `IncomingMessage` / `ServerResponse`, not
Fetch. You'll need a small Node↔Web adapter (or use the MCP
SDK's `StreamableHTTPServerTransport` instead, which is
Node-native — out of scope here). For most consumers, Hono or
Next.js are easier paths.

## Runtime portability

| Runtime                 | Status | Notes                                                    |
| ----------------------- | ------ | -------------------------------------------------------- |
| Node 18+                | ✅     | Plain Node servers, Express via Web-Standards adapter    |
| Cloudflare Workers      | ✅     | Fetch-API native; no Node-API dependencies               |
| Vercel Functions (Node) | ✅     | App Router route handler                                 |
| Vercel Functions (Edge) | ✅     | Same shape; Edge runtime supports the Web Standards APIs |
| AWS Lambda              | ✅     | Via AWS Lambda Web Adapter                               |
| Hono                    | ✅     | `app.all("/mcp", handler)`                               |
| Bun                     | ✅     | `Bun.serve({ fetch: handler })`                          |
| Deno                    | ✅     | `Deno.serve(handler)`                                    |

All cryptographic operations use Web Crypto (no `node:crypto`
direct imports). The constant-time bearer compare is portable.

## Stability commitment

The `createWhatsAppHttpHandler` factory, the `WhatsAppHttpHandler`
type, the `AuthInfo` re-export, and the 401 JSON-RPC error
shape are stable under semver from `mcp-v1.0.0` onwards. (The
handler itself ships in `mcp-v1.1.0` — the v1.1 commitment
applies from that release.)

- Adding new options to `CreateWhatsAppHttpHandlerInput`:
  non-breaking under semver.
- Adding new fields to `AuthInfo`: governed by the MCP SDK's
  semver promise.
- Renaming or removing options: requires a major bump.
- Tightening the 401 response body shape (e.g. changing the
  error code): requires a major bump.

## See also

- [`docs/mcp/embedded.md`](./embedded.md) — when you want the
  tools without the MCP protocol layer.
- [`docs/mcp/transports.md`](./transports.md) — stdio vs HTTP
  trade-offs.
- [`docs/cookbook/mcp/streamable-http-vercel.md`](../cookbook/mcp/streamable-http-vercel.md)
  — end-to-end Vercel + JWT recipe.
- [MCP Streamable HTTP spec](https://spec.modelcontextprotocol.io/specification/2025-06-18/basic/transports/#streamable-http)
