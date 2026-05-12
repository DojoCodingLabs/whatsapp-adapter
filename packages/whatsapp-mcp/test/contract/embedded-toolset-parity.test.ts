import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { createWhatsAppToolset, WhatsAppMcpServer } from "../../src/index.js";

/**
 * Drift detector for the embedded toolset / stdio server parity
 * invariant. The same 16 tool names, 2 resource URIs, 1 prompt
 * name, and the same input-schema JSON Schemas SHALL be exposed
 * by both paths.
 *
 * If a tool is added to one path without the other, this fails.
 * If a tool is renamed in one path without the other, this fails.
 * If an inputSchema diverges between paths, this fails.
 */

async function listFromMcpServer(): Promise<{
  toolNames: string[];
  toolSchemas: Map<string, unknown>;
  resourceNamesOrUris: string[];
  promptNames: string[];
}> {
  const client = new MockWhatsAppClient({
    phoneNumberId: "PNID",
    wabaId: "WABA",
  });
  const server = new WhatsAppMcpServer({
    client,
    wabaPhoneNumberId: "PNID",
  });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "drift-detector", version: "0.0.0" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  try {
    const tools = await mcpClient.listTools();
    const resources = await mcpClient.listResources();
    const resourceTemplates = await mcpClient.listResourceTemplates();
    const prompts = await mcpClient.listPrompts();

    const toolSchemas = new Map<string, unknown>();
    for (const t of tools.tools) {
      toolSchemas.set(t.name, t.inputSchema);
    }

    return {
      toolNames: tools.tools.map((t) => t.name).sort(),
      toolSchemas,
      resourceNamesOrUris: [
        ...resources.resources.map((r) => r.uri),
        ...resourceTemplates.resourceTemplates.map((r) => r.uriTemplate),
      ].sort(),
      promptNames: prompts.prompts.map((p) => p.name).sort(),
    };
  } finally {
    await Promise.all([mcpClient.close(), server.close()]);
  }
}

describe("Embedded toolset / stdio server parity", () => {
  it("exposes the same 16 tool names", async () => {
    const client = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    const toolset = createWhatsAppToolset({ client, wabaPhoneNumberId: "PNID" });
    const toolsetNames = toolset.tools.map((t) => t.name).sort();

    const server = await listFromMcpServer();

    expect(toolsetNames).toEqual(server.toolNames);
    expect(toolsetNames).toHaveLength(16);
  });

  it("exposes the same 2 resources (1 fixed URI + 1 URI template)", async () => {
    const client = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    const toolset = createWhatsAppToolset({ client, wabaPhoneNumberId: "PNID" });
    const toolsetIds = toolset.resources.map((r) => r.uri ?? r.uriTemplate ?? "").sort();

    const server = await listFromMcpServer();

    expect(toolsetIds).toEqual(server.resourceNamesOrUris);
    expect(toolsetIds).toHaveLength(2);
  });

  it("exposes the same 1 prompt", async () => {
    const client = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    const toolset = createWhatsAppToolset({ client, wabaPhoneNumberId: "PNID" });
    const toolsetNames = toolset.prompts.map((p) => p.name).sort();

    const server = await listFromMcpServer();

    expect(toolsetNames).toEqual(server.promptNames);
    expect(toolsetNames).toHaveLength(1);
  });

  it("emits byte-identical JSON Schema for each tool's inputSchema", async () => {
    const client = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    const toolset = createWhatsAppToolset({ client, wabaPhoneNumberId: "PNID" });
    const server = await listFromMcpServer();

    for (const def of toolset.tools) {
      const toolsetJsonSchema = zodToJsonSchema(z.object(def.inputSchema));
      const serverJsonSchema = server.toolSchemas.get(def.name);
      expect(serverJsonSchema, `server is missing schema for ${def.name}`).toBeDefined();

      // The MCP SDK serialises the same zod object via the same
      // `zodToJsonSchema` helper. Parsed objects should be deep-equal.
      // Stringify both to defeat reference-identity bias and surface
      // shape diffs in test failure output.
      expect(
        JSON.parse(JSON.stringify(serverJsonSchema)),
        `inputSchema drift for tool ${def.name}`
      ).toEqual(JSON.parse(JSON.stringify(toolsetJsonSchema)));
    }
  });
});
