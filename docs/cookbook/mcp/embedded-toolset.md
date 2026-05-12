# Cookbook — Embedded toolset in a Next.js App Router MCP gateway

A complete recipe: wrap `@dojocoding/whatsapp-mcp`'s 16 tools
inside your own MCP gateway running on Vercel serverless,
alongside other upstream toolsets, routed by tool-name prefix.

This is the pattern Site2Print uses to merge our WhatsApp tools
with their Alegra accounting tools behind a single `/api/mcp`
endpoint with OAuth at the edge.

## Why this layout

- **Vercel serverless can't host a stdio MCP child** — functions
  are short-lived and there's no place for a long-running
  subprocess.
- **Streamable HTTP transport is post-1.0 on our roadmap** —
  meanwhile, the embedded toolset gives you the same 16 tools
  inside any HTTP runtime today.
- **Your gateway likely already does auth** — you don't want a
  separate `Authorization: Bearer` flow for every upstream;
  authenticate once at the edge, dispatch by name.
- **Tool naming is stable** — the `whatsapp_*` prefix makes
  routing trivial without registering each name individually.

## Layout

```
app/
└── api/
    └── mcp/
        └── route.ts         # the gateway
lib/
└── mcp/
    ├── auth.ts              # your OAuth verifier
    ├── whatsapp-toolset.ts  # this file
    └── alegra-toolset.ts    # other upstream (analogous shape)
```

## `lib/mcp/whatsapp-toolset.ts`

Singleton-ish: one `WhatsAppClient` + one `WhatsAppToolset` per
process. Lazy-built so cold starts don't pay for upstream
initialisation if no `whatsapp_*` tool is invoked in this
request.

```ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppToolset, type WhatsAppToolset } from "@dojocoding/whatsapp-mcp";

let cached: WhatsAppToolset | null = null;

export function getWhatsAppToolset(): WhatsAppToolset {
  if (cached) return cached;

  const client = new WhatsAppClient({
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
    token: process.env.WHATSAPP_ACCESS_TOKEN!,
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
  });

  cached = createWhatsAppToolset({
    client,
    wabaPhoneNumberId: client.phoneNumberId,
  });
  return cached;
}
```

## `app/api/mcp/route.ts`

The gateway dispatches MCP JSON-RPC requests by method name:

```ts
import { NextRequest, NextResponse } from "next/server";

import { verifyAccessToken } from "@/lib/mcp/auth";
import { getWhatsAppToolset } from "@/lib/mcp/whatsapp-toolset";
import { getAlegraToolset } from "@/lib/mcp/alegra-toolset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth at the edge.
  const authHeader = req.headers.get("authorization");
  if (!(await verifyAccessToken(authHeader))) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized" } },
      { status: 401 }
    );
  }

  const body = (await req.json()) as JsonRpcRequest;
  const whatsapp = getWhatsAppToolset();
  const alegra = getAlegraToolset();

  // 2. Route by JSON-RPC method.
  switch (body.method) {
    case "initialize":
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "site2print-mcp", version: "1.0.0" },
        },
      });

    case "tools/list":
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [...whatsapp.tools, ...alegra.tools].map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: toJsonSchema(t.inputSchema),
            ...(t.outputSchema ? { outputSchema: toJsonSchema(t.outputSchema) } : {}),
            ...(t.annotations ? { annotations: t.annotations } : {}),
          })),
        },
      });

    case "tools/call": {
      const params = body.params as { name: string; arguments: unknown };
      const targetToolset = params.name.startsWith("whatsapp_") ? whatsapp : alegra;
      const result = await targetToolset.dispatch(params.name, params.arguments);
      return NextResponse.json({ jsonrpc: "2.0", id: body.id, result });
    }

    case "resources/list":
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          resources: [...whatsapp.resources, ...alegra.resources]
            .filter((r) => r.uri !== undefined)
            .map((r) => ({
              uri: r.uri!,
              name: r.name,
              title: r.title,
              description: r.description,
              mimeType: r.mimeType,
            })),
        },
      });

    case "resources/read": {
      const params = body.params as { uri: string };
      const targetToolset = params.uri.startsWith("whatsapp://") ? whatsapp : alegra;
      const result = await targetToolset.readResource(params.uri);
      return NextResponse.json({ jsonrpc: "2.0", id: body.id, result });
    }

    case "prompts/list":
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          prompts: [...whatsapp.prompts, ...alegra.prompts].map((p) => ({
            name: p.name,
            title: p.title,
            description: p.description,
            ...(p.argsSchema ? { arguments: argsSchemaToList(p.argsSchema) } : {}),
          })),
        },
      });

    case "prompts/get": {
      const params = body.params as { name: string; arguments?: Record<string, unknown> };
      const targetToolset = params.name === "wa-template-send" ? whatsapp : alegra;
      const result = await targetToolset.renderPrompt(params.name, params.arguments);
      return NextResponse.json({ jsonrpc: "2.0", id: body.id, result });
    }

    default:
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: `Method not found: ${body.method}` },
        },
        { status: 200 } // JSON-RPC errors are 200 OK; the error field carries the failure
      );
  }
}

// Helpers — implement once and share. The zod-to-json-schema
// package is the canonical pick (the MCP SDK uses it internally).
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

function toJsonSchema(shape: Record<string, z.ZodTypeAny>): unknown {
  return zodToJsonSchema(z.object(shape));
}

function argsSchemaToList(shape: Record<string, z.ZodTypeAny>): unknown[] {
  return Object.entries(shape).map(([name, schema]) => ({
    name,
    description: schema.description ?? "",
    required: !(schema instanceof z.ZodOptional),
  }));
}
```

## What this buys you

- **One auth boundary.** Your existing OAuth 2.1 + PKCE + JWT
  flow validates the bearer at `verifyAccessToken`. Toolsets
  never see credentials.
- **Stateless function**, with the toolset cached at module
  scope. Vercel warm starts are instant; cold starts pay one
  `new WhatsAppClient(...)` per upstream.
- **Tool surface stays in sync with our releases** — bump
  `@dojocoding/whatsapp-mcp` to a new minor and your gateway
  picks up new tools without code changes. Renames fail CI on
  our side; you upgrade at your own pace.
- **Mock mode** for staging is one env var: set
  `WHATSAPP_ACCESS_TOKEN=dev-only-not-used` and swap in
  `pickWhatsAppClient({ forceMock: true })` (or use the SDK's
  factory) in your `whatsapp-toolset.ts`. The toolset's surface
  is identical between real and mock — your gateway code never
  changes.

## Caveats

- **Window-state on Vercel.** The
  `whatsapp://window/{phone}` resource needs a `WindowTracker`
  with shared storage (Postgres / Redis) to be useful across
  serverless invocations. The in-memory default returns
  `isOpen: false` for every read.
- **OTel spans** ride on the SDK's existing pipeline. Configure
  the OTel exporter once at module init in
  `whatsapp-toolset.ts`; the toolset's `dispatch` runs all the
  same `withSpan` wraps the stdio server does.
- **`waitUntil` for async dispatch** is unrelated to this
  pattern — the toolset's `dispatch` returns a resolved
  `Promise<CallToolResult>` synchronously enough that you don't
  need it for tool calls. You only need `waitUntil` if you're
  also running the SDK's webhook receiver on the same Vercel
  function; see [`docs/sdk/web.md`](../../sdk/web.md) §
  "Next.js App Router".

## See also

- [`docs/mcp/embedded.md`](../../mcp/embedded.md) — the toolset API reference.
- [`docs/cookbook/coexistence/vercel-chat-sdk.md`](../coexistence/vercel-chat-sdk.md)
  — when Dojo SDK is outbound-only and another library owns inbound.
- [`docs/cookbook/integrations/next-app-router-supabase.md`](../integrations/next-app-router-supabase.md)
  — the full Site2Print-shape end-to-end.
