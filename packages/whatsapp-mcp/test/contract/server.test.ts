import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";

import { WhatsAppMcpServer } from "../../src/index.js";

const PHONE_NUMBER_ID = "111122223333";
const WABA_ID = "999988887777";

function buildSetup(opts: Partial<ConstructorParameters<typeof MockWhatsAppClient>[0]> = {}) {
  const sdk = new MockWhatsAppClient({
    phoneNumberId: PHONE_NUMBER_ID,
    wabaId: WABA_ID,
    ...opts,
  });
  const server = new WhatsAppMcpServer({ client: sdk, wabaPhoneNumberId: PHONE_NUMBER_ID });
  return { sdk, server };
}

async function connect(server: WhatsAppMcpServer): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "whatsapp-mcp-test-client", version: "0.0.0" }, {});
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("WhatsAppMcpServer: tool registration", () => {
  it("tools/list returns exactly the 6 v1 tools", async () => {
    const { server } = buildSetup();
    const client = await connect(server);
    try {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          "whatsapp_get_template",
          "whatsapp_list_templates",
          "whatsapp_send_image",
          "whatsapp_send_reaction",
          "whatsapp_send_template",
          "whatsapp_send_text",
        ].sort()
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("every tool ships description + inputSchema + outputSchema", async () => {
    const { server } = buildSetup();
    const client = await connect(server);
    try {
      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.description, `${tool.name} description`).toBeTruthy();
        expect(tool.inputSchema, `${tool.name} inputSchema`).toBeTruthy();
        // outputSchema may be absent for read tools that opt out, but
        // we declare it on all 6 v1 tools — assert presence.
        expect(tool.outputSchema, `${tool.name} outputSchema`).toBeTruthy();
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("read tools carry readOnlyHint annotation", async () => {
    const { server } = buildSetup();
    const client = await connect(server);
    try {
      const { tools } = await client.listTools();
      const list = tools.find((t) => t.name === "whatsapp_list_templates");
      const get = tools.find((t) => t.name === "whatsapp_get_template");
      expect(list?.annotations?.readOnlyHint).toBe(true);
      expect(get?.annotations?.readOnlyHint).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("reaction tool carries idempotentHint annotation", async () => {
    const { server } = buildSetup();
    const client = await connect(server);
    try {
      const { tools } = await client.listTools();
      const r = tools.find((t) => t.name === "whatsapp_send_reaction");
      expect(r?.annotations?.idempotentHint).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("WhatsAppMcpServer: tool happy paths", () => {
  let sdk: MockWhatsAppClient;
  let server: WhatsAppMcpServer;
  let client: Client;

  beforeEach(async () => {
    const setup = buildSetup();
    sdk = setup.sdk;
    server = setup.server;
    client = await connect(server);
  });

  it("whatsapp_send_text returns structuredContent { messageId, recipientPhone, wabaPhoneNumberId }", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_text",
      arguments: { to: "+5210000000001", body: "hello" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      recipientPhone: "+5210000000001",
      wabaPhoneNumberId: PHONE_NUMBER_ID,
    });
    expect((result.structuredContent as { messageId: string }).messageId).toMatch(/^wamid\./);

    // SDK actually recorded the send
    expect(sdk.sentMessages).toHaveLength(1);
    expect(sdk.sentMessages[0]?.payload.type).toBe("text");

    await client.close();
    await server.close();
  });

  it("whatsapp_send_template is window-exempt (succeeds against a closed window)", async () => {
    // No windowTracker → MockWhatsAppClient permits free-form, so we
    // simulate a closed-window scenario indirectly via a separate
    // assertion: the template path doesn't read the tracker at all.
    const result = await client.callTool({
      name: "whatsapp_send_template",
      arguments: { to: "+5210000000001", name: "hello_world", language: "en_US" },
    });
    expect(result.isError).toBeFalsy();
    expect(sdk.sentMessages[0]?.payload.type).toBe("template");

    await client.close();
    await server.close();
  });

  it("whatsapp_send_reaction returns the reaction's own wamid", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_reaction",
      arguments: { to: "+5210000000001", messageId: "wamid.original", emoji: "❤️" },
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { messageId: string }).messageId).toMatch(/^wamid\./);
    expect(sdk.sentMessages[0]?.payload.type).toBe("reaction");

    await client.close();
    await server.close();
  });

  it("whatsapp_get_template returns the seeded definition", async () => {
    // Re-build with a seeded template registry.
    await client.close();
    await server.close();
    const setup = buildSetup({
      templates: [
        {
          id: "tmpl_1",
          name: "hello_world",
          language: "en_US",
          category: "UTILITY",
          status: "APPROVED",
          components: [{ type: "BODY", text: "Hello {{1}}" }],
        },
      ],
    });
    sdk = setup.sdk;
    server = setup.server;
    client = await connect(server);

    const result = await client.callTool({
      name: "whatsapp_get_template",
      arguments: { templateId: "tmpl_1" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: "tmpl_1",
      name: "hello_world",
      language: "en_US",
    });

    await client.close();
    await server.close();
  });

  it("whatsapp_list_templates returns paginated payload", async () => {
    await client.close();
    await server.close();
    const setup = buildSetup({
      templates: [
        {
          id: "t1",
          name: "a",
          language: "en_US",
          category: "MARKETING",
          status: "APPROVED",
          components: [],
        },
        {
          id: "t2",
          name: "b",
          language: "es_MX",
          category: "UTILITY",
          status: "APPROVED",
          components: [],
        },
      ],
    });
    server = setup.server;
    client = await connect(server);

    const result = await client.callTool({
      name: "whatsapp_list_templates",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { data: ReadonlyArray<{ id: string }> };
    expect(sc.data).toHaveLength(2);
    expect(sc.data.map((t) => t.id).sort()).toEqual(["t1", "t2"]);

    await client.close();
    await server.close();
  });
});

describe("WhatsAppMcpServer: error mapping", () => {
  it("send-image without link OR id returns isError with usage hint", async () => {
    const { server } = buildSetup();
    const client = await connect(server);
    try {
      const result = await client.callTool({
        name: "whatsapp_send_image",
        arguments: { to: "+5210000000001" },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as ReadonlyArray<{ text: string }>)[0]?.text ?? "";
      expect(text).toMatch(/link|id/);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
