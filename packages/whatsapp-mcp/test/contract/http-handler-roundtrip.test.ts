import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expect, it } from "vitest";

import { createWhatsAppHttpHandler, type WhatsAppHttpHandler } from "../../src/index.js";

/**
 * End-to-end protocol roundtrip over the HTTP handler. Wires an
 * MCP `Client` against the handler via a `fetch` proxy — the
 * client speaks real Streamable HTTP, the handler responds via
 * the real WebStandardStreamableHTTPServerTransport. No real
 * network, no real MSW; the handler IS the upstream.
 *
 * Asserts the HTTP path round-trips initialize → tools/list →
 * tools/call → resources/read → prompts/get with the same
 * surface as the stdio + embedded paths.
 */

function makeHandler(): WhatsAppHttpHandler {
  const client = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
  return createWhatsAppHttpHandler({ client, wabaPhoneNumberId: "PNID" });
}

/**
 * Build a Streamable-HTTP MCP client wired to call `handler`
 * directly (no real HTTP listener). The MCP SDK's
 * `StreamableHTTPClientTransport` calls `fetch(...)` for every
 * request; we override the `fetch` option to invoke the handler
 * in-process and return its Response.
 */
async function connectMcpClient(handler: WhatsAppHttpHandler): Promise<Client> {
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const proxyFetch = ((input: URL | string | Request, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request && init === undefined ? input : new Request(input, init);
    return handler(req);
  }) as typeof fetch;
  const transport = new StreamableHTTPClientTransport(new URL("https://app.example/mcp"), {
    fetch: proxyFetch,
  });
  const client = new Client({ name: "http-roundtrip-test", version: "0.0.0" }, {});
  // The MCP SDK's transport type has `sessionId: string` (not optional) but
  // exactOptionalPropertyTypes flags the missing initial value. The Client
  // accepts the transport at runtime; cast to bypass the structural mismatch.
  await client.connect(transport as never);
  return client;
}

const EXPECTED_TOOLS = [
  "whatsapp_send_text",
  "whatsapp_send_image",
  "whatsapp_send_video",
  "whatsapp_send_audio",
  "whatsapp_send_voice",
  "whatsapp_send_document",
  "whatsapp_send_location",
  "whatsapp_send_contacts",
  "whatsapp_send_interactive_buttons",
  "whatsapp_send_interactive_list",
  "whatsapp_send_template",
  "whatsapp_send_auth_template",
  "whatsapp_send_carousel_template",
  "whatsapp_send_reaction",
  "whatsapp_list_templates",
  "whatsapp_get_template",
].sort();

describe("HTTP handler — end-to-end protocol roundtrip", () => {
  it("initialize handshake returns capabilities for tools/resources/prompts", async () => {
    const handler = makeHandler();
    const client = await connectMcpClient(handler);
    try {
      const caps = client.getServerCapabilities();
      expect(caps?.tools).toBeDefined();
      expect(caps?.resources).toBeDefined();
      expect(caps?.prompts).toBeDefined();
    } finally {
      await client.close();
    }
  });

  it("tools/list returns exactly the 16 expected tools", async () => {
    const handler = makeHandler();
    const client = await connectMcpClient(handler);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(EXPECTED_TOOLS);
    } finally {
      await client.close();
    }
  });

  it("tools/call whatsapp_send_text round-trips with structuredContent.messageId", async () => {
    const handler = makeHandler();
    const client = await connectMcpClient(handler);
    try {
      const result = await client.callTool({
        name: "whatsapp_send_text",
        arguments: { to: "+5210000000001", body: "hi from http" },
      });
      const sc = result.structuredContent as { messageId: string; recipientPhone: string };
      expect(sc.messageId).toMatch(/^wamid\.mock-\d+$/);
      expect(sc.recipientPhone).toBe("+5210000000001");
    } finally {
      await client.close();
    }
  });

  it("resources/list returns the 2 expected resources", async () => {
    const handler = makeHandler();
    const client = await connectMcpClient(handler);
    try {
      const { resources } = await client.listResources();
      const { resourceTemplates } = await client.listResourceTemplates();
      const uris = [
        ...resources.map((r) => r.uri),
        ...resourceTemplates.map((r) => r.uriTemplate),
      ].sort();
      expect(uris).toEqual(["whatsapp://templates", "whatsapp://window/{phone}"]);
    } finally {
      await client.close();
    }
  });

  it("resources/read whatsapp://templates returns the cached body", async () => {
    const handler = makeHandler();
    const client = await connectMcpClient(handler);
    try {
      const { contents } = await client.readResource({ uri: "whatsapp://templates" });
      expect(contents).toHaveLength(1);
      const text = (contents[0] as { text?: string }).text;
      expect(text).toBeDefined();
      const body = JSON.parse(text!) as { data: unknown[]; cachedAt: string };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.cachedAt).toBeDefined();
    } finally {
      await client.close();
    }
  });

  it("prompts/list returns the 1 expected prompt", async () => {
    const handler = makeHandler();
    const client = await connectMcpClient(handler);
    try {
      const { prompts } = await client.listPrompts();
      expect(prompts.map((p) => p.name).sort()).toEqual(["wa-template-send"]);
    } finally {
      await client.close();
    }
  });

  it("prompts/get wa-template-send returns the rendered guided messages", async () => {
    const handler = makeHandler();
    const client = await connectMcpClient(handler);
    try {
      const { messages } = await client.getPrompt({ name: "wa-template-send", arguments: {} });
      expect(messages).toHaveLength(1);
      const content = messages[0]?.content as { type: string; text?: string };
      expect(content.type).toBe("text");
      expect(content.text).toMatch(/whatsapp:\/\/templates/);
    } finally {
      await client.close();
    }
  });
});
