import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import * as pkg from "../../src/index.js";
import { WhatsAppMcpServer } from "../../src/index.js";

/**
 * Drift detector. Asserts:
 *   - the documented named exports from `@dojocoding/whatsapp-mcp`
 *     are still reachable at runtime
 *   - the registered tool names match the v1 spec exactly
 *
 * If a future change accidentally renames an export or drops a tool,
 * this test fails BEFORE consumers do.
 */

const EXPECTED_EXPORTS = [
  "buildServer",
  "WhatsAppMcpServer",
  "loadConfigFromEnv",
  "McpConfigError",
  "mapSdkError",
  "withErrorMapping",
  "SEND_TEXT_TOOL",
  "SEND_IMAGE_TOOL",
  "SEND_TEMPLATE_TOOL",
  "SEND_REACTION_TOOL",
  "LIST_TEMPLATES_TOOL",
  "GET_TEMPLATE_TOOL",
] as const;

const EXPECTED_V1_TOOL_NAMES = [
  "whatsapp_send_text",
  "whatsapp_send_image",
  "whatsapp_send_template",
  "whatsapp_send_reaction",
  "whatsapp_list_templates",
  "whatsapp_get_template",
].sort();

describe("public-surface drift detector", () => {
  for (const name of EXPECTED_EXPORTS) {
    it(`exports ${name}`, () => {
      expect((pkg as Record<string, unknown>)[name]).toBeDefined();
    });
  }

  it("registered tool names match the v1 spec exactly (no missing, no extra)", async () => {
    const sdk = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    const server = new WhatsAppMcpServer({ client: sdk, wabaPhoneNumberId: "PNID" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "drift-test", version: "0.0.0" }, {});
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const { tools } = await client.listTools();
      const got = tools.map((t) => t.name).sort();
      expect(got).toEqual(EXPECTED_V1_TOOL_NAMES);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("tool-name constants exported from the package match the registered names", async () => {
    const sdk = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    const server = new WhatsAppMcpServer({ client: sdk, wabaPhoneNumberId: "PNID" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "drift-test", version: "0.0.0" }, {});
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const { tools } = await client.listTools();
      const registered = new Set(tools.map((t) => t.name));
      expect(registered.has(pkg.SEND_TEXT_TOOL)).toBe(true);
      expect(registered.has(pkg.SEND_IMAGE_TOOL)).toBe(true);
      expect(registered.has(pkg.SEND_TEMPLATE_TOOL)).toBe(true);
      expect(registered.has(pkg.SEND_REACTION_TOOL)).toBe(true);
      expect(registered.has(pkg.LIST_TEMPLATES_TOOL)).toBe(true);
      expect(registered.has(pkg.GET_TEMPLATE_TOOL)).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
