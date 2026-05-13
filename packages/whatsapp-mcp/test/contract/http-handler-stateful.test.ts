import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { describe, expect, it } from "vitest";

import { createWhatsAppHttpHandler, type WhatsAppHttpHandler } from "../../src/index.js";

/**
 * Stateful-mode contract. The handler defaults to `stateless: true`
 * (per-request build/dispose, the only safe shape for serverless).
 * Stateful mode is opt-in and only safe on long-lived Node / Bun /
 * Deno servers.
 *
 * In stateful mode:
 *   - Server + transport are built ONCE at factory time.
 *   - The transport tracks sessions in-memory keyed by the
 *     `Mcp-Session-Id` response header.
 *   - Multiple requests from the same client share session state.
 *
 * This suite exists because the default stateless tests don't
 * exercise the !stateless branch (src/http.ts:146-151, 186-187).
 */

function initRequest(sessionId?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId !== undefined) {
    headers["mcp-session-id"] = sessionId;
  }
  return new Request("https://app.example/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "stateful-test", version: "0.0.0" },
      },
    }),
  });
}

function makeStatefulHandler(): WhatsAppHttpHandler {
  return createWhatsAppHttpHandler({
    client: new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" }),
    wabaPhoneNumberId: "PNID",
    stateless: false,
  });
}

describe("createWhatsAppHttpHandler — stateful mode", () => {
  it("initializes with a session id in the response headers", async () => {
    const handler = makeStatefulHandler();
    const res = await handler(initRequest());
    expect(res.status).not.toBe(401);
    // Stateful mode advertises a session id back to the client
    // via the Mcp-Session-Id header on the initialize response.
    const sessionHeader = res.headers.get("mcp-session-id");
    expect(sessionHeader).toBeTruthy();
    expect(typeof sessionHeader).toBe("string");
    expect(sessionHeader!.length).toBeGreaterThan(0);
  });

  it("uses a custom sessionIdGenerator when supplied", async () => {
    let counter = 0;
    const handler = createWhatsAppHttpHandler({
      client: new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" }),
      wabaPhoneNumberId: "PNID",
      stateless: false,
      sessionIdGenerator: (): string => {
        counter += 1;
        return `custom-session-${counter}`;
      },
    });

    const res = await handler(initRequest());
    expect(res.headers.get("mcp-session-id")).toBe("custom-session-1");
    expect(counter).toBe(1);
  });

  it("rejects subsequent requests with an invalid session id (per MCP spec)", async () => {
    const handler = makeStatefulHandler();
    // Initialize once to set up session tracking.
    await handler(initRequest());
    // Now send a non-initialize request claiming a bogus session.
    const followup = new Request("https://app.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": "bogus-session-id-not-issued",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
    });
    const res = await handler(followup);
    // MCP spec: invalid session id → 404 Not Found.
    expect(res.status).toBe(404);
  });

  it("shares the transport across concurrent stateless-mode requests too (sanity)", async () => {
    // Stateless mode constructs a fresh server+transport per
    // request — but the factory returns the same closure. Just
    // assert two parallel stateless requests don't interfere.
    const handler = createWhatsAppHttpHandler({
      client: new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" }),
      wabaPhoneNumberId: "PNID",
      // stateless: true is the default
    });
    const [a, b] = await Promise.all([handler(initRequest()), handler(initRequest())]);
    expect(a.status).not.toBe(401);
    expect(b.status).not.toBe(401);
  });

  it("stateful mode + bearer auth — auth blocks BEFORE session establishment", async () => {
    const handler = createWhatsAppHttpHandler({
      client: new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" }),
      wabaPhoneNumberId: "PNID",
      stateless: false,
      staticToken: "secret-1",
    });
    const req = new Request("https://app.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        // Wrong token.
        authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(401);
    // 401 body is the canonical JSON-RPC error shape (same as stateless).
    expect(res.headers.get("mcp-session-id")).toBeNull();
  });
});
