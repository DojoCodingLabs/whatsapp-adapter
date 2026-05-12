# Cookbook — Streamable HTTP MCP on Vercel with JWT auth

End-to-end recipe: host `@dojocoding/whatsapp-mcp`'s 16-tool
surface as a real MCP Streamable HTTP endpoint on Vercel
serverless, authenticated via a JWT verifier callback.

The "outer gateway with embedded toolset" pattern
([`embedded-toolset.md`](./embedded-toolset.md)) is the right
choice when you're merging the WhatsApp tools with other
upstreams. This recipe is the right choice when you want a
**standalone MCP HTTP endpoint** that any MCP client (Claude
Agent SDK with Streamable HTTP, `claude.ai` web custom
connectors, a third-party MCP gateway you don't own) can
connect to.

## What you'll build

```
MCP client ──Bearer JWT──▶ POST /api/mcp ──verifyToken──▶ AuthInfo
                                  │
                                  ▼
                          MCP Streamable HTTP
                          (16 whatsapp_* tools)
                                  │
                                  ▼
                          @dojocoding/whatsapp-sdk
                                  │
                                  ▼
                            Meta Graph API
```

The MCP server lives at `https://your-app.vercel.app/api/mcp`.
Clients authenticate with `Authorization: Bearer <jwt>`. The
JWT is verified against your own issuer's JWKS via `jose`. On
success the MCP request proceeds; on failure the handler
returns a 401 with a JSON-RPC error body.

## 0. Prerequisites

- A Next.js 14+ App Router project on Vercel.
- A Meta WABA + System User token (see
  [`docs/mcp/quickstart.md`](../../mcp/quickstart.md) for the
  walkthrough).
- An identity provider issuing JWTs you can validate against
  a JWKS — Auth0, Cognito, Clerk, your own SSO, etc.

## 1. Install

```bash
pnpm add @dojocoding/whatsapp-sdk @dojocoding/whatsapp-mcp jose
```

## 2. Env vars

```env
# .env.local + Vercel project env
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_BUSINESS_ACCOUNT_ID=9876543210
WHATSAPP_APP_SECRET=abc...

# JWT verification config
JWT_ISSUER=https://your-tenant.auth0.com/
JWT_AUDIENCE=https://your-app.vercel.app/api/mcp
JWT_JWKS_URI=https://your-tenant.auth0.com/.well-known/jwks.json
```

## 3. The JWT verifier

A reusable verifier that caches the JWKS in-memory per warm
function instance:

```ts
// lib/mcp-auth.ts
import type { AuthInfo } from "@dojocoding/whatsapp-mcp";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const jwks = createRemoteJWKSet(new URL(process.env.JWT_JWKS_URI!));

const REQUIRED_SCOPE = "whatsapp.send";

interface ExpectedClaims extends JWTPayload {
  scope?: string;
  client_id?: string;
}

export async function verifyMcpBearer(token: string, _req: Request): Promise<AuthInfo | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    });
    const claims = payload as ExpectedClaims;

    // Scope check — only allow tokens that carry whatsapp.send.
    // Many issuers serialize scopes as a space-separated string.
    const scopes = (claims.scope ?? "").split(" ").filter(Boolean);
    if (!scopes.includes(REQUIRED_SCOPE)) {
      return null;
    }

    return {
      token, // the raw JWT — message handlers may need it for downstream calls
      clientId: claims.client_id ?? (typeof claims.sub === "string" ? claims.sub : "unknown"),
      scopes,
      ...(typeof claims.exp === "number" ? { expiresAt: claims.exp } : {}),
    };
  } catch {
    // jwtVerify throws on signature mismatch, expired token,
    // wrong audience/issuer, etc. Treat any failure as null
    // so the handler returns 401 — we don't distinguish
    // verification-failure causes to the caller.
    return null;
  }
}
```

## 4. The Next.js route handler

```ts
// app/api/mcp/route.ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHttpHandler } from "@dojocoding/whatsapp-mcp";

import { verifyMcpBearer } from "@/lib/mcp-auth";

export const runtime = "nodejs"; // jose works fine on Edge too; pick per your stack
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
  verifyToken: verifyMcpBearer,
});

export { handler as GET, handler as POST, handler as DELETE };
```

That's it. The endpoint is live at
`https://your-app.vercel.app/api/mcp`.

## 5. Verify locally

```bash
# Get a JWT from your issuer (Auth0 example using client-credentials)
TOKEN=$(curl -s -X POST https://your-tenant.auth0.com/oauth/token \
  -H "content-type: application/json" \
  -d '{
    "client_id":"...",
    "client_secret":"...",
    "audience":"https://your-app.vercel.app/api/mcp",
    "grant_type":"client_credentials",
    "scope":"whatsapp.send"
  }' | jq -r .access_token)

# Initialize handshake
curl -s -X POST https://your-app.vercel.app/api/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-06-18",
      "capabilities":{},
      "clientInfo":{"name":"curl-test","version":"0.0.0"}
    }
  }'

# Expected: 200 with the initialize result (capabilities,
# serverInfo, etc.). Without the bearer, you get a 401 with
# {"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"Unauthorized"}}.
```

## 6. Connecting from claude.ai web

`claude.ai`'s custom-connector flow accepts any MCP server
speaking Streamable HTTP with a public HTTPS endpoint. Point
the connector at `https://your-app.vercel.app/api/mcp`; the
flow prompts for a bearer token; paste the JWT minted via your
issuer's UI. Claude's chat surface then sees the 16
`whatsapp_*` tools alongside its built-in ones.

## 7. Caveats

- **`maxDuration` budget.** Vercel kills serverless functions
  at 60 s on Hobby, 300 s on Pro. Streamable HTTP responses
  can be long-lived (the SSE pattern). For most `tools/call`
  invocations against the WhatsApp SDK, total elapsed is under
  a second — well within budget. If you wire your handler to
  also serve server-initiated notifications (long-poll-style),
  bump `export const maxDuration = 300;` at the top of
  `route.ts`.
- **Cold starts** (~300-800 ms on Vercel Node) live on top of
  every fresh MCP request. JWT verification adds ~5-10 ms when
  the JWKS is cached, ~100 ms on first hit per function
  instance (JWKS fetch). Tolerable but visible.
- **Stateless mode** is the default. Sessions don't survive
  cold starts. If your client relies on MCP session
  continuity (rare for `tools/call`-only workflows), set
  `stateless: false` AND deploy to a single-instance,
  long-running runtime (not Vercel serverless).
- **Multi-tenant** — `verifyToken` receives the `Request` as
  its second argument; use this to surface per-tenant claims
  into `AuthInfo.extra`. The MCP server's tool handlers can
  read `AuthInfo` via the SDK's auth surface and dispatch
  to a per-tenant `WhatsAppClient` if needed. Out of scope
  for this recipe.

## 8. Why not `staticToken`?

`staticToken` is the right pick for closed-network deployments
or defence-in-depth behind an outer OAuth gateway. The JWT
verifier shape covers everything `staticToken` does plus
expiration, audience, issuer checks, and per-token scopes —
strictly more flexible at the cost of one library dependency.

Use `staticToken` when:

- Your endpoint is private (VPC, mTLS, IP allow-list) and the
  bearer is a rotated-out-of-band shared secret.
- You're behind an OAuth gateway that's already validated the
  request — `staticToken` is then a defence-in-depth check.

Use `verifyToken` when:

- The endpoint is public.
- Tokens come from a real identity provider.
- You need scope-based authz beyond binary admit/deny.

## See also

- [`docs/mcp/http.md`](../../mcp/http.md) — handler reference.
- [`docs/cookbook/mcp/embedded-toolset.md`](./embedded-toolset.md) —
  when you have your own MCP gateway and just want the tools.
- [`docs/cookbook/integrations/next-app-router-supabase.md`](../integrations/next-app-router-supabase.md)
  — the Site2Print full-stack recipe (Postgres window state,
  webhook receiver, MCP toolset under one Next.js app).
