import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { sendMessage } from "../../../src/messages/send.js";
import { WhatsAppError } from "../../../src/types/errors.js";

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

describe("sendMessage()", () => {
  it("POSTs to /{phoneNumberId}/messages and parses MessageSendResponse", async () => {
    let captured: { url: string; body: string } | null = null;
    server.use(
      http.post("https://graph.facebook.com/v23.0/PNID/messages", async ({ request }) => {
        captured = { url: request.url, body: await request.text() };
        return HttpResponse.json(
          {
            messaging_product: "whatsapp",
            contacts: [{ input: "521234567890", wa_id: "521234567890" }],
            messages: [{ id: "wamid.123" }],
          },
          { status: 200 }
        );
      })
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const response = await client.sendText(
      { to: "521234567890", body: "hi" },
      { retryPolicy: NO_RETRY }
    );

    expect(response).toEqual({
      messaging_product: "whatsapp",
      contacts: [{ input: "521234567890", wa_id: "521234567890" }],
      messages: [{ id: "wamid.123" }],
    });

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe("https://graph.facebook.com/v23.0/PNID/messages");
    expect(JSON.parse(captured!.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "521234567890",
      type: "text",
      text: { body: "hi" },
    });
  });

  it("validator failure happens BEFORE any HTTP call", async () => {
    let calls = 0;
    server.use(
      http.post("https://graph.facebook.com/v23.0/PNID/messages", () => {
        calls += 1;
        return HttpResponse.json({}, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    expect(() => client.sendText({ to: "", body: "hi" }, { retryPolicy: NO_RETRY })).toThrow(
      WhatsAppError
    );
    // Allow the event loop to settle in case any microtask leaked.
    await Promise.resolve();
    expect(calls).toBe(0);
  });

  it("sendReply attaches context.message_id and POSTs", async () => {
    let captured: string = "";
    server.use(
      http.post("https://graph.facebook.com/v23.0/PNID/messages", async ({ request }) => {
        captured = await request.text();
        return HttpResponse.json(
          {
            messaging_product: "whatsapp",
            contacts: [{ input: "X", wa_id: "X" }],
            messages: [{ id: "wamid.999" }],
          },
          { status: 200 }
        );
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.sendReply(
      "wamid.parent",
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "X",
        type: "text",
        text: { body: "ack" },
      },
      { retryPolicy: NO_RETRY }
    );
    const parsed = JSON.parse(captured) as { context: { message_id: string } };
    expect(parsed.context).toEqual({ message_id: "wamid.parent" });
  });

  it("standalone sendMessage helper round-trips equivalently", async () => {
    server.use(
      http.post("https://graph.facebook.com/v23.0/PNID/messages", () =>
        HttpResponse.json(
          {
            messaging_product: "whatsapp",
            contacts: [{ input: "X", wa_id: "X" }],
            messages: [{ id: "wamid.1" }],
          },
          { status: 200 }
        )
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const out = await sendMessage(
      client,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "X",
        type: "reaction",
        reaction: { message_id: "wamid.parent", emoji: "👍" },
      },
      { retryPolicy: NO_RETRY }
    );
    expect(out.messages[0]?.id).toBe("wamid.1");
  });
});
