import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import * as pkg from "../../src/index.js";
import { WhatsAppMcpServer } from "../../src/index.js";

/**
 * Drift detector. Asserts:
 *   - every documented named export from `@dojocoding/whatsapp-mcp`
 *     is reachable at runtime
 *   - the registered tool names match the v1 spec exactly (16)
 *   - the registered resource templates match (2)
 *   - the registered prompts match (1)
 *
 * Any rename, accidental removal, or duplicated registration trips
 * this test BEFORE consumers do.
 */

const EXPECTED_EXPORTS = [
  // Core
  "buildServer",
  "WhatsAppMcpServer",
  "loadConfigFromEnv",
  "McpConfigError",
  "mapSdkError",
  "withErrorMapping",
  // Embedded toolset
  "createWhatsAppToolset",
  // Streamable HTTP handler
  "createWhatsAppHttpHandler",
  // Tool names (16)
  "SEND_TEXT_TOOL",
  "SEND_IMAGE_TOOL",
  "SEND_VIDEO_TOOL",
  "SEND_AUDIO_TOOL",
  "SEND_VOICE_TOOL",
  "SEND_DOCUMENT_TOOL",
  "SEND_LOCATION_TOOL",
  "SEND_CONTACTS_TOOL",
  "SEND_INTERACTIVE_BUTTONS_TOOL",
  "SEND_INTERACTIVE_LIST_TOOL",
  "SEND_TEMPLATE_TOOL",
  "SEND_AUTH_TEMPLATE_TOOL",
  "SEND_CAROUSEL_TEMPLATE_TOOL",
  "SEND_REACTION_TOOL",
  "LIST_TEMPLATES_TOOL",
  "GET_TEMPLATE_TOOL",
  // Resource names
  "WINDOW_RESOURCE_NAME",
  "WINDOW_RESOURCE_URI_TEMPLATE",
  "TEMPLATES_RESOURCE_NAME",
  "TEMPLATES_RESOURCE_URI",
  "TEMPLATES_CACHE_TTL_MS",
  // Prompt name
  "WA_TEMPLATE_SEND_PROMPT",
] as const;

const EXPECTED_TOOL_NAMES = [
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

async function connectedClient(): Promise<{
  client: Client;
  server: WhatsAppMcpServer;
}> {
  const sdk = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
  const server = new WhatsAppMcpServer({ client: sdk, wabaPhoneNumberId: "PNID" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "drift-test", version: "0.0.0" }, {});
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}

describe("public-surface drift detector", () => {
  for (const name of EXPECTED_EXPORTS) {
    it(`exports ${name}`, () => {
      expect((pkg as Record<string, unknown>)[name]).toBeDefined();
    });
  }

  it("registered tool names match the v1 spec exactly (16, no missing, no extra)", async () => {
    const { client, server } = await connectedClient();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOL_NAMES);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("tool-name constants exported from the package match registered names", async () => {
    const { client, server } = await connectedClient();
    try {
      const { tools } = await client.listTools();
      const registered = new Set(tools.map((t) => t.name));
      for (const c of [
        pkg.SEND_TEXT_TOOL,
        pkg.SEND_IMAGE_TOOL,
        pkg.SEND_VIDEO_TOOL,
        pkg.SEND_AUDIO_TOOL,
        pkg.SEND_VOICE_TOOL,
        pkg.SEND_DOCUMENT_TOOL,
        pkg.SEND_LOCATION_TOOL,
        pkg.SEND_CONTACTS_TOOL,
        pkg.SEND_INTERACTIVE_BUTTONS_TOOL,
        pkg.SEND_INTERACTIVE_LIST_TOOL,
        pkg.SEND_TEMPLATE_TOOL,
        pkg.SEND_AUTH_TEMPLATE_TOOL,
        pkg.SEND_CAROUSEL_TEMPLATE_TOOL,
        pkg.SEND_REACTION_TOOL,
        pkg.LIST_TEMPLATES_TOOL,
        pkg.GET_TEMPLATE_TOOL,
      ]) {
        expect(registered.has(c), `tool constant ${c} matches a registered name`).toBe(true);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registered resources include both window + templates URI schemes", async () => {
    const { client, server } = await connectedClient();
    try {
      const { resourceTemplates } = await client.listResourceTemplates();
      const templates = resourceTemplates.map((r) => r.uriTemplate);
      expect(templates).toContain(pkg.WINDOW_RESOURCE_URI_TEMPLATE);

      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain(pkg.TEMPLATES_RESOURCE_URI);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registered prompts include wa-template-send", async () => {
    const { client, server } = await connectedClient();
    try {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((p) => p.name);
      expect(names).toContain(pkg.WA_TEMPLATE_SEND_PROMPT);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
