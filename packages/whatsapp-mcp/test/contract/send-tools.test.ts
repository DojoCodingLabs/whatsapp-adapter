import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WhatsAppMcpServer } from "../../src/index.js";

const PHONE_NUMBER_ID = "111122223333";
const WABA_ID = "999988887777";

let sdk: MockWhatsAppClient;
let server: WhatsAppMcpServer;
let client: Client;

async function setup(): Promise<void> {
  sdk = new MockWhatsAppClient({ phoneNumberId: PHONE_NUMBER_ID, wabaId: WABA_ID });
  server = new WhatsAppMcpServer({ client: sdk, wabaPhoneNumberId: PHONE_NUMBER_ID });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "send-tools-test", version: "0.0.0" }, {});
  await Promise.all([server.connect(a), client.connect(b)]);
}

async function teardown(): Promise<void> {
  await client.close();
  await server.close();
}

beforeEach(setup);
afterEach(teardown);

function assertSendResult(result: unknown): {
  messageId: string;
  recipientPhone: string;
  wabaPhoneNumberId: string;
} {
  const r = result as {
    isError?: boolean | undefined;
    structuredContent?: {
      messageId: string;
      recipientPhone: string;
      wabaPhoneNumberId: string;
    };
  };
  expect(r.isError, JSON.stringify(r)).toBeFalsy();
  const sc = r.structuredContent;
  if (!sc) throw new Error(`no structuredContent on tool result: ${JSON.stringify(r)}`);
  expect(sc.messageId).toMatch(/^wamid\./);
  expect(sc.wabaPhoneNumberId).toBe(PHONE_NUMBER_ID);
  return sc;
}

describe("Phase C2 send tools — happy paths", () => {
  it("whatsapp_send_video records a video send", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_video",
      arguments: { to: "+5210000000001", link: "https://example.com/v.mp4" },
    });
    const sc = assertSendResult(result);
    expect(sc.recipientPhone).toBe("+5210000000001");
    expect(sdk.sentMessages[0]?.payload.type).toBe("video");
  });

  it("whatsapp_send_audio records an audio send", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_audio",
      arguments: { to: "+5210000000001", link: "https://example.com/a.mp3" },
    });
    assertSendResult(result);
    expect(sdk.sentMessages[0]?.payload.type).toBe("audio");
  });

  it("whatsapp_send_voice records an audio send with voice: true", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_voice",
      arguments: { to: "+5210000000001", link: "https://example.com/v.ogg" },
    });
    assertSendResult(result);
    const payload = sdk.sentMessages[0]?.payload as
      | { type: string; audio?: { voice?: boolean } }
      | undefined;
    expect(payload?.type).toBe("audio");
    expect(payload?.audio?.voice).toBe(true);
  });

  it("whatsapp_send_document records a document send with filename", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_document",
      arguments: {
        to: "+5210000000001",
        link: "https://example.com/invoice.pdf",
        filename: "invoice.pdf",
      },
    });
    assertSendResult(result);
    const payload = sdk.sentMessages[0]?.payload as
      | { type: string; document?: { filename?: string } }
      | undefined;
    expect(payload?.type).toBe("document");
    expect(payload?.document?.filename).toBe("invoice.pdf");
  });

  it("whatsapp_send_location records a location with name + address", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_location",
      arguments: {
        to: "+5210000000001",
        latitude: 19.4326,
        longitude: -99.1332,
        name: "Centro CDMX",
        address: "Plaza de la Constitución",
      },
    });
    assertSendResult(result);
    const payload = sdk.sentMessages[0]?.payload as
      | { type: string; location?: { latitude: number; longitude: number; name?: string } }
      | undefined;
    expect(payload?.type).toBe("location");
    expect(payload?.location?.latitude).toBe(19.4326);
    expect(payload?.location?.name).toBe("Centro CDMX");
  });

  it("whatsapp_send_contacts records a contacts send", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_contacts",
      arguments: {
        to: "+5210000000001",
        contacts: [
          {
            name: { formatted_name: "Alice Doe", first_name: "Alice" },
            phones: [{ phone: "+5210000000099", type: "CELL" }],
          },
        ],
      },
    });
    assertSendResult(result);
    expect(sdk.sentMessages[0]?.payload.type).toBe("contacts");
  });

  it("whatsapp_send_interactive_buttons records an interactive button send", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_interactive_buttons",
      arguments: {
        to: "+5210000000001",
        body: "Pick one",
        buttons: [
          { id: "yes", title: "Yes" },
          { id: "no", title: "No" },
        ],
      },
    });
    assertSendResult(result);
    expect(sdk.sentMessages[0]?.payload.type).toBe("interactive");
  });

  it("whatsapp_send_interactive_list records an interactive list send", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_interactive_list",
      arguments: {
        to: "+5210000000001",
        body: "Pick a slot",
        button: "View slots",
        sections: [
          {
            title: "Monday",
            rows: [
              { id: "mon-9", title: "9:00 AM" },
              { id: "mon-10", title: "10:00 AM", description: "Morning" },
            ],
          },
        ],
      },
    });
    assertSendResult(result);
    expect(sdk.sentMessages[0]?.payload.type).toBe("interactive");
  });

  it("whatsapp_send_auth_template records a template send (window-exempt)", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_auth_template",
      arguments: {
        to: "+5210000000001",
        name: "otp_login",
        language: "en_US",
        otp: "123456",
      },
    });
    assertSendResult(result);
    expect(sdk.sentMessages[0]?.payload.type).toBe("template");
  });

  it("whatsapp_send_carousel_template records a carousel template send", async () => {
    const result = await client.callTool({
      name: "whatsapp_send_carousel_template",
      arguments: {
        to: "+5210000000001",
        name: "summer_sale",
        language: "en_US",
        bodyParameters: ["Alice"],
        cards: [
          {
            header: { type: "image", link: "https://example.com/a.jpg" },
            bodyParameters: ["Item A"],
          },
          {
            header: { type: "image", link: "https://example.com/b.jpg" },
          },
        ],
      },
    });
    assertSendResult(result);
    expect(sdk.sentMessages[0]?.payload.type).toBe("template");
  });
});

describe("Phase C2 send tools — input validation", () => {
  // The MCP framework surfaces zod validation failures as a
  // tool-call response with `isError: true` whose `content[0].text`
  // contains the zod failure code. The SDK never reaches the
  // handler, so we never see an actual `WhatsAppError`. Assert
  // both flags + a code in the body.

  async function expectValidationError(name: string, args: Record<string, unknown>): Promise<void> {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean | undefined;
      content?: ReadonlyArray<{ text?: string }>;
    };
    expect(result.isError, `${name} should return isError=true`).toBe(true);
    const head = result.content?.[0];
    expect(head?.text ?? "").toMatch(
      /validation|too_small|too_big|too_large|invalid_type|invalid/i
    );
  }

  it("send_location rejects latitude out of range", async () => {
    await expectValidationError("whatsapp_send_location", {
      to: "+5210000000001",
      latitude: 200,
      longitude: 0,
    });
  });

  it("send_interactive_buttons rejects empty buttons array", async () => {
    await expectValidationError("whatsapp_send_interactive_buttons", {
      to: "+5210000000001",
      body: "x",
      buttons: [],
    });
  });

  it("send_interactive_buttons rejects more than 3 buttons", async () => {
    await expectValidationError("whatsapp_send_interactive_buttons", {
      to: "+5210000000001",
      body: "x",
      buttons: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
        { id: "c", title: "C" },
        { id: "d", title: "D" },
      ],
    });
  });

  it("send_interactive_list rejects too many sections", async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ({
      title: `S${i}`,
      rows: [{ id: `r${i}`, title: "row" }],
    }));
    await expectValidationError("whatsapp_send_interactive_list", {
      to: "+5210000000001",
      body: "x",
      button: "go",
      sections: tooMany,
    });
  });

  it("send_carousel_template rejects empty cards array", async () => {
    await expectValidationError("whatsapp_send_carousel_template", {
      to: "+5210000000001",
      name: "t",
      language: "en_US",
      cards: [],
    });
  });

  it("send_carousel_template rejects more than 10 cards", async () => {
    const tooMany = Array.from({ length: 11 }, () => ({
      header: { type: "image", link: "https://example.com/x.jpg" },
    }));
    await expectValidationError("whatsapp_send_carousel_template", {
      to: "+5210000000001",
      name: "t",
      language: "en_US",
      cards: tooMany,
    });
  });

  it("send_auth_template rejects otp longer than 15 chars", async () => {
    await expectValidationError("whatsapp_send_auth_template", {
      to: "+5210000000001",
      name: "otp",
      language: "en_US",
      otp: "1234567890ABCDEF",
    });
  });

  it("send_contacts rejects empty contacts array", async () => {
    await expectValidationError("whatsapp_send_contacts", {
      to: "+5210000000001",
      contacts: [],
    });
  });
});
