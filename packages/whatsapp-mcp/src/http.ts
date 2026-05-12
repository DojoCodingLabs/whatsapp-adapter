/**
 * MCP Streamable HTTP handler — Fetch-API native, runs on any
 * Web-Standards runtime (Cloudflare Workers, Vercel Functions,
 * Hono, Next.js App Router, Bun, Deno, plain Node 18+).
 *
 * Wraps the MCP SDK's `WebStandardStreamableHTTPServerTransport`
 * around a `buildServer(...)` instance (same registration logic
 * as the stdio bin) plus an optional bearer-auth pipeline.
 *
 * Use this when:
 *   - Your runtime can't host a long-lived stdio child process
 *     (Vercel serverless, Cloudflare Workers, AWS Lambda).
 *   - You want a turn-key MCP HTTP endpoint without wiring your
 *     own gateway over `createWhatsAppToolset`.
 *
 * See `docs/mcp/http.md` for the consumer reference and
 * `docs/cookbook/mcp/streamable-http-vercel.md` for an
 * end-to-end Vercel + JWT recipe.
 */

import type { WhatsAppLikeClient, WindowTracker } from "@dojocoding/whatsapp-sdk";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { buildServer } from "./server.js";

export type { AuthInfo };

/**
 * Input for {@link createWhatsAppHttpHandler}.
 */
export interface CreateWhatsAppHttpHandlerInput {
  /** SDK client bound to a single WABA-phone pair. */
  client: WhatsAppLikeClient;
  /** Phone-number-id this handler speaks for. */
  wabaPhoneNumberId: string;
  /** Optional 24-h window tracker forwarded to the resource layer. */
  windowTracker?: WindowTracker;
  /** Override the package version reported via the MCP handshake. */
  serverVersion?: string;
  /**
   * Session-id generator (only used when `stateless: false`).
   * Defaults to `crypto.randomUUID()` for cryptographic security
   * and Web-Standards portability.
   */
  sessionIdGenerator?: () => string;
  /**
   * Stateless mode. When `true` (default), no session tracking —
   * each request is independent. Right for serverless deployments
   * where state cannot survive between invocations.
   *
   * When `false`, the transport tracks sessions in-memory keyed
   * by the `Mcp-Session-Id` header. Appropriate for long-lived
   * Node / Bun / Deno servers; NOT appropriate for serverless
   * without an external session store (sessions live in this
   * process only).
   */
  stateless?: boolean;
  /**
   * Static shared-secret bearer. When supplied, the handler
   * extracts `Authorization: Bearer <token>` from every request
   * and constant-time-compares against this value. Mismatch or
   * missing header → 401.
   *
   * Mutually compatible with `verifyToken`: if both are set,
   * `verifyToken` takes precedence.
   *
   * Leave both auth options unset to delegate authentication
   * to your outer gateway.
   */
  staticToken?: string;
  /**
   * Bearer-verifier callback. Receives the extracted token plus
   * the original `Request` for context (e.g. to check the
   * `Origin` header or per-request claims). Returns:
   *
   *   - `AuthInfo` — the MCP SDK auth shape carrying clientId,
   *     scopes, expiresAt, etc. The handler passes this verbatim
   *     to `transport.handleRequest({ authInfo })` so message
   *     handlers can read it.
   *   - `null` — authentication failed; the handler returns 401.
   *
   * Callback exceptions are NOT caught — they propagate as
   * unhandled HTTP errors. Wrap in your own try/catch if you
   * want a custom error response.
   */
  verifyToken?: (token: string, req: Request) => Promise<AuthInfo | null>;
}

/**
 * Returned handler shape. Mountable as a Cloudflare Workers
 * `fetch` handler, a Hono `app.all` callback, a Next.js App
 * Router route handler, a Bun `Bun.serve` handler, etc.
 */
export type WhatsAppHttpHandler = (req: Request) => Promise<Response>;

const BEARER_PREFIX_RE = /^bearer\s+(.+)$/i;
const TEXT_ENCODER = new TextEncoder();

/**
 * Build a Fetch-API MCP Streamable HTTP handler wired to the
 * WhatsApp SDK. Safe to construct at module scope; safe to
 * reuse across concurrent requests.
 *
 * @example
 * ```ts
 * // app/api/mcp/route.ts (Next.js App Router on Vercel)
 * import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
 * import { createWhatsAppHttpHandler } from "@dojocoding/whatsapp-mcp";
 *
 * export const runtime = "nodejs";
 *
 * const handler = createWhatsAppHttpHandler({
 *   client: new WhatsAppClient({ ... }),
 *   wabaPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
 *   staticToken: process.env.MCP_GATEWAY_TOKEN!,
 * });
 *
 * export { handler as GET, handler as POST, handler as DELETE };
 * ```
 */
export function createWhatsAppHttpHandler(
  input: CreateWhatsAppHttpHandlerInput
): WhatsAppHttpHandler {
  const stateless = input.stateless ?? true;
  const buildInput = {
    client: input.client,
    wabaPhoneNumberId: input.wabaPhoneNumberId,
    ...(input.windowTracker !== undefined ? { windowTracker: input.windowTracker } : {}),
    ...(input.serverVersion !== undefined ? { serverVersion: input.serverVersion } : {}),
  };

  // Stateful mode: build server + transport ONCE at factory
  // time and share across requests. Sessions are tracked
  // in-memory by the transport.
  //
  // Stateless mode: per-request build/dispose. The MCP SDK's
  // stateless transport rejects reuse across requests (it's a
  // one-shot SSE stream that terminates after responding) so we
  // must allocate a fresh pair per request. McpServer
  // registration is cheap (~ms); the per-request cost is
  // dominated by network IO, not allocation.
  let sharedTransport: WebStandardStreamableHTTPServerTransport | undefined;
  let sharedConnectPromise: Promise<void> | undefined;
  if (!stateless) {
    const server = buildServer(buildInput);
    sharedTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: input.sessionIdGenerator ?? ((): string => crypto.randomUUID()),
    });
    sharedConnectPromise = server.connect(sharedTransport);
  }

  const verifyToken = input.verifyToken;
  const staticTokenBytes =
    input.staticToken !== undefined ? TEXT_ENCODER.encode(input.staticToken) : undefined;
  const requireAuth = staticTokenBytes !== undefined || verifyToken !== undefined;

  return async (req: Request): Promise<Response> => {
    // Auth pipeline runs BEFORE building the transport so an
    // unauthenticated request never pays the per-request server
    // construction cost.
    let authInfo: AuthInfo | undefined;
    if (requireAuth) {
      const authHeader = req.headers.get("authorization");
      const match = authHeader !== null ? BEARER_PREFIX_RE.exec(authHeader) : null;
      const token = match !== null ? match[1] : undefined;
      if (token === undefined) {
        return unauthorizedResponse();
      }
      if (verifyToken !== undefined) {
        const result = await verifyToken(token, req);
        if (result === null) {
          return unauthorizedResponse();
        }
        authInfo = result;
      } else {
        const incomingBytes = TEXT_ENCODER.encode(token);
        if (!constantTimeEqual(staticTokenBytes!, incomingBytes)) {
          return unauthorizedResponse();
        }
      }
    }

    let transport: WebStandardStreamableHTTPServerTransport;
    if (sharedTransport !== undefined) {
      await sharedConnectPromise;
      transport = sharedTransport;
    } else {
      // Per-request build for stateless mode.
      const server = buildServer(buildInput);
      transport = new WebStandardStreamableHTTPServerTransport({});
      await server.connect(transport);
    }

    return transport.handleRequest(req, authInfo !== undefined ? { authInfo } : {});
  };
}

/**
 * Constant-time byte-wise compare. No early-exit on first
 * mismatch — runtime is bounded by `a.length` regardless of
 * where the inputs differ. Uses no Node-API-only primitives;
 * runs on every Web-Standards runtime.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/**
 * Build the canonical 401 response. The body is JSON-RPC-shaped
 * so MCP clients see a typed error rather than a bare HTTP
 * status. The body does NOT vary across the three "auth failed"
 * paths (missing header / bad static token / verifyToken
 * returned null) — clients cannot infer the failure cause from
 * the body alone.
 */
function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Unauthorized" },
    }),
    {
      status: 401,
      headers: { "content-type": "application/json" },
    }
  );
}
