import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  type AuthInfo,
  createWhatsAppHttpHandler,
  type WhatsAppHttpHandler,
} from "../../src/index.js";

/**
 * Bearer-auth pipeline contract for createWhatsAppHttpHandler.
 * Covers the three real-world shapes: no-auth (delegate to outer
 * gateway), static-token shared-secret, and verifyToken callback.
 */

function makeClient(): MockWhatsAppClient {
  return new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
}

function initRequest(token?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token !== undefined) {
    headers["authorization"] = `Bearer ${token}`;
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
        clientInfo: { name: "test-client", version: "0.0.0" },
      },
    }),
  });
}

async function assertUnauthorized(res: Response): Promise<void> {
  expect(res.status).toBe(401);
  const body = (await res.json()) as {
    jsonrpc: string;
    id: null;
    error: { code: number; message: string };
  };
  expect(body.jsonrpc).toBe("2.0");
  expect(body.id).toBeNull();
  expect(body.error.code).toBe(-32001);
  expect(body.error.message).toBe("Unauthorized");
}

async function assertNotUnauthorized(res: Response): Promise<void> {
  expect(res.status).not.toBe(401);
}

describe("createWhatsAppHttpHandler — auth pipeline", () => {
  it("no auth set + no Authorization header → passes through", async () => {
    const handler: WhatsAppHttpHandler = createWhatsAppHttpHandler({
      client: makeClient(),
      wabaPhoneNumberId: "PNID",
    });
    const res = await handler(initRequest());
    await assertNotUnauthorized(res);
  });

  it("staticToken set + matching Bearer → passes through", async () => {
    const handler = createWhatsAppHttpHandler({
      client: makeClient(),
      wabaPhoneNumberId: "PNID",
      staticToken: "secret-1",
    });
    const res = await handler(initRequest("secret-1"));
    await assertNotUnauthorized(res);
  });

  it("staticToken set + missing Authorization → 401 with JSON-RPC body", async () => {
    const handler = createWhatsAppHttpHandler({
      client: makeClient(),
      wabaPhoneNumberId: "PNID",
      staticToken: "secret-1",
    });
    await assertUnauthorized(await handler(initRequest()));
  });

  it("staticToken set + wrong token → 401", async () => {
    const handler = createWhatsAppHttpHandler({
      client: makeClient(),
      wabaPhoneNumberId: "PNID",
      staticToken: "secret-1",
    });
    await assertUnauthorized(await handler(initRequest("wrong-token")));
  });

  it("staticToken — case-insensitive Bearer scheme prefix per RFC 6750", async () => {
    const handler = createWhatsAppHttpHandler({
      client: makeClient(),
      wabaPhoneNumberId: "PNID",
      staticToken: "secret-1",
    });
    const req = new Request("https://app.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        // lowercase scheme prefix
        authorization: "bearer secret-1",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.0.0" },
        },
      }),
    });
    await assertNotUnauthorized(await handler(req));
  });

  it("verifyToken returning null → 401", async () => {
    const verifyToken = vi.fn(async () => null);
    const handler = createWhatsAppHttpHandler({
      client: makeClient(),
      wabaPhoneNumberId: "PNID",
      verifyToken,
    });
    await assertUnauthorized(await handler(initRequest("anything")));
    expect(verifyToken).toHaveBeenCalledTimes(1);
    expect(verifyToken).toHaveBeenCalledWith("anything", expect.any(Request));
  });

  it("verifyToken returning AuthInfo → passes through with auth context", async () => {
    const authInfo: AuthInfo = {
      token: "valid-jwt",
      clientId: "test-client",
      scopes: ["whatsapp.send"],
    };
    const verifyToken = vi.fn(async () => authInfo);
    const handler = createWhatsAppHttpHandler({
      client: makeClient(),
      wabaPhoneNumberId: "PNID",
      verifyToken,
    });
    const res = await handler(initRequest("valid-jwt"));
    await assertNotUnauthorized(res);
    expect(verifyToken).toHaveBeenCalledTimes(1);
  });

  it("both verifyToken AND staticToken set → verifyToken takes precedence", async () => {
    const handler = createWhatsAppHttpHandler({
      client: makeClient(),
      wabaPhoneNumberId: "PNID",
      // staticToken would match — but verifyToken rejects
      staticToken: "would-match",
      verifyToken: async () => null,
    });
    await assertUnauthorized(await handler(initRequest("would-match")));
  });

  it("missing Authorization header when auth is required → 401 (does NOT invoke verifyToken)", async () => {
    const verifyToken = vi.fn(async () => ({
      token: "x",
      clientId: "y",
      scopes: [],
    }));
    const handler = createWhatsAppHttpHandler({
      client: makeClient(),
      wabaPhoneNumberId: "PNID",
      verifyToken,
    });
    await assertUnauthorized(await handler(initRequest()));
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it("401 body does NOT echo the rejected token", async () => {
    const sensitiveToken = "sensitive-token-leak-canary";
    const handler = createWhatsAppHttpHandler({
      client: makeClient(),
      wabaPhoneNumberId: "PNID",
      staticToken: "different-secret",
    });
    const res = await handler(initRequest(sensitiveToken));
    const body = await res.text();
    expect(body).not.toContain(sensitiveToken);
    expect(body).not.toContain("sensitive");
  });
});
