import { readFileSync } from "node:fs";

import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { WhatsAppMcpServer } from "../../src/index.js";
import { MCP_VERSION } from "../../src/version.js";

describe("MCP_VERSION", () => {
  it("matches package.json (bump both together)", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as { version: string };
    expect(MCP_VERSION).toBe(pkg.version);
  });

  it("is the default serverInfo.version", async () => {
    const sdk = new MockWhatsAppClient({ phoneNumberId: "111122223333", wabaId: "999988887777" });
    const server = new WhatsAppMcpServer({ client: sdk, wabaPhoneNumberId: "111122223333" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "version-test", version: "0.0.0" }, {});
    await Promise.all([server.connect(a), client.connect(b)]);
    expect(client.getServerVersion()).toMatchObject({
      name: "@dojocoding/whatsapp-mcp",
      version: MCP_VERSION,
    });
    await client.close();
  });
});
