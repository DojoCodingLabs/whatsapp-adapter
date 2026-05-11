import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { WA_TEMPLATE_SEND_PROMPT, WhatsAppMcpServer } from "../../src/index.js";

let server: WhatsAppMcpServer | undefined;
let client: Client | undefined;

async function connected(): Promise<{ client: Client; server: WhatsAppMcpServer }> {
  const sdk = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
  const s = new WhatsAppMcpServer({ client: sdk, wabaPhoneNumberId: "PNID" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "prompts-test", version: "0.0.0" }, {});
  await Promise.all([s.connect(a), c.connect(b)]);
  server = s;
  client = c;
  return { client: c, server: s };
}

afterEach(async () => {
  await client?.close();
  await server?.close();
  client = undefined;
  server = undefined;
});

function firstMessageText(messages: ReadonlyArray<unknown>): string {
  const first = messages[0] as { content: { type: string; text?: string } } | undefined;
  if (!first || first.content.type !== "text" || typeof first.content.text !== "string") {
    throw new Error(`expected first message to be text, got ${JSON.stringify(first)}`);
  }
  return first.content.text;
}

describe("prompt: wa-template-send", () => {
  it("appears in prompts/list with the documented argsSchema", async () => {
    const { client: c } = await connected();
    const { prompts } = await c.listPrompts();
    const found = prompts.find((p) => p.name === WA_TEMPLATE_SEND_PROMPT);
    expect(found).toBeDefined();
    expect(found?.description).toBeTruthy();
    const argNames = found?.arguments?.map((a) => a.name) ?? [];
    expect(argNames).toContain("templateName");
    expect(argNames).toContain("recipientPhone");
  });

  it("with no args: instructs the model to read the templates resource and ask for recipient", async () => {
    const { client: c } = await connected();
    const result = await c.getPrompt({ name: WA_TEMPLATE_SEND_PROMPT, arguments: {} });
    const text = firstMessageText(result.messages);
    expect(text).toMatch(/whatsapp:\/\/templates/);
    expect(text).toMatch(/recipient phone/i);
    expect(text).toMatch(/whatsapp_get_template/);
    expect(text).toMatch(/whatsapp_send_template/);
  });

  it("with templateName: skips the list step and proceeds to get_template + ask for vars", async () => {
    const { client: c } = await connected();
    const result = await c.getPrompt({
      name: WA_TEMPLATE_SEND_PROMPT,
      arguments: { templateName: "summer_sale" },
    });
    const text = firstMessageText(result.messages);
    expect(text).toMatch(/summer_sale/);
    // Should NOT instruct the model to list templates first since one was given.
    expect(text).not.toMatch(/Read the `whatsapp:\/\/templates` resource/);
  });

  it("with both templateName + recipientPhone: surfaces both values verbatim", async () => {
    const { client: c } = await connected();
    const result = await c.getPrompt({
      name: WA_TEMPLATE_SEND_PROMPT,
      arguments: { templateName: "promo_v1", recipientPhone: "+5210000000001" },
    });
    const text = firstMessageText(result.messages);
    expect(text).toMatch(/promo_v1/);
    expect(text).toMatch(/\+5210000000001/);
  });
});
