import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const VALID_OPTIONS = {
  phoneNumberId: "PNID",
  wabaId: "WABA",
  token: "TOKEN-VALUE",
  appSecret: "APP-SECRET-VALUE",
} as const;

const NO_RETRY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitter: "full" as const,
  floorMs: 0,
};

const TO = "521234567890";

interface Captured {
  method: string;
  url: string;
  body: string;
}

function setupMockSendEndpoint(captures: Captured[]) {
  server.use(
    http.post("https://graph.facebook.com/v23.0/PNID/messages", async ({ request }) => {
      captures.push({
        method: request.method,
        url: request.url,
        body: await request.text(),
      });
      return HttpResponse.json(
        {
          messaging_product: "whatsapp",
          contacts: [{ input: TO, wa_id: TO }],
          messages: [{ id: "wamid.test" }],
        },
        { status: 200 }
      );
    })
  );
}

describe("WhatsAppClient send* convenience methods", () => {
  it.each([
    {
      name: "sendText",
      run: (c: WhatsAppClient) => c.sendText({ to: TO, body: "hi" }, { retryPolicy: NO_RETRY }),
      expectType: "text",
    },
    {
      name: "sendImage",
      run: (c: WhatsAppClient) =>
        c.sendImage({ to: TO, link: "https://example.com/cat.png" }, { retryPolicy: NO_RETRY }),
      expectType: "image",
    },
    {
      name: "sendVideo",
      run: (c: WhatsAppClient) =>
        c.sendVideo({ to: TO, link: "https://example.com/v.mp4" }, { retryPolicy: NO_RETRY }),
      expectType: "video",
    },
    {
      name: "sendAudio",
      run: (c: WhatsAppClient) =>
        c.sendAudio({ to: TO, id: "audio-id" }, { retryPolicy: NO_RETRY }),
      expectType: "audio",
    },
    {
      name: "sendDocument",
      run: (c: WhatsAppClient) =>
        c.sendDocument(
          { to: TO, link: "https://example.com/doc.pdf", filename: "doc.pdf" },
          { retryPolicy: NO_RETRY }
        ),
      expectType: "document",
    },
    {
      name: "sendSticker",
      run: (c: WhatsAppClient) =>
        c.sendSticker({ to: TO, id: "sticker-id" }, { retryPolicy: NO_RETRY }),
      expectType: "sticker",
    },
    {
      name: "sendLocation",
      run: (c: WhatsAppClient) =>
        c.sendLocation({ to: TO, latitude: 0, longitude: 0 }, { retryPolicy: NO_RETRY }),
      expectType: "location",
    },
    {
      name: "sendContacts",
      run: (c: WhatsAppClient) =>
        c.sendContacts(
          { to: TO, contacts: { name: { formatted_name: "Jane" } } },
          { retryPolicy: NO_RETRY }
        ),
      expectType: "contacts",
    },
    {
      name: "sendInteractive (button)",
      run: (c: WhatsAppClient) =>
        c.sendInteractive(
          {
            kind: "button",
            to: TO,
            body: "Pick",
            buttons: [{ id: "a", title: "A" }],
          },
          { retryPolicy: NO_RETRY }
        ),
      expectType: "interactive",
    },
    {
      name: "sendTemplate",
      run: (c: WhatsAppClient) =>
        c.sendTemplate(
          { to: TO, name: "hello_world", language: "en_US" },
          { retryPolicy: NO_RETRY }
        ),
      expectType: "template",
    },
    {
      name: "sendReaction",
      run: (c: WhatsAppClient) =>
        c.sendReaction({ to: TO, messageId: "wamid.x", emoji: "👍" }, { retryPolicy: NO_RETRY }),
      expectType: "reaction",
    },
  ])(
    "$name posts to /{phoneNumberId}/messages with type=$expectType",
    async ({ run, expectType }) => {
      const captures: Captured[] = [];
      setupMockSendEndpoint(captures);
      const client = new WhatsAppClient({ ...VALID_OPTIONS });
      const response = await run(client);
      expect(captures).toHaveLength(1);
      expect(captures[0]!.method).toBe("POST");
      expect(captures[0]!.url).toBe("https://graph.facebook.com/v23.0/PNID/messages");
      const parsed = JSON.parse(captures[0]!.body) as { type: string };
      expect(parsed.type).toBe(expectType);
      expect(response.messages[0]?.id).toBe("wamid.test");
    }
  );

  it("sendReply rejects an empty replyTo synchronously without HTTP", async () => {
    const captures: Captured[] = [];
    setupMockSendEndpoint(captures);
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    expect(() =>
      client.sendReply("", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: TO,
        type: "text",
        text: { body: "x" },
      })
    ).toThrow();
    await Promise.resolve();
    expect(captures).toHaveLength(0);
  });
});
