import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { buildTemplate } from "../../../src/messages/builders.js";
import { InMemoryStorage } from "../../../src/storage/index.js";
import { WindowTracker } from "../../../src/window/tracker.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const VALID = {
  phoneNumberId: "PNID",
  wabaId: "WABA",
  token: "TOKEN",
  appSecret: "APP-SECRET",
} as const;

const NO_RETRY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitter: "full" as const,
  floorMs: 0,
};

/**
 * sendReply window-exempt path. When the wrapped payload is a
 * TemplateMessage (or ReactionMessage), sendReply should NOT
 * pre-flight the 24-hour window — templates are the canonical
 * out-of-window send. The wire payload should still carry the
 * context.message_id pointing at replyTo.
 */

describe("sendReply with TemplateMessage payload (window-exempt)", () => {
  it("sends without consulting the window tracker; payload includes context.message_id", async () => {
    let capturedBody: string | null = null;
    server.use(
      http.post("https://graph.facebook.com/v25.0/PNID/messages", async ({ request }) => {
        capturedBody = await request.text();
        return HttpResponse.json(
          {
            messaging_product: "whatsapp",
            contacts: [{ input: "+5210000000001", wa_id: "+5210000000001" }],
            messages: [{ id: "wamid.real-1" }],
          },
          { status: 200 }
        );
      })
    );

    // Window tracker with NO inbound notification → window is CLOSED.
    // sendReply with a TemplateMessage payload MUST succeed anyway.
    const tracker = new WindowTracker({
      phoneNumberId: "PNID",
      storage: new InMemoryStorage(),
    });
    expect(await tracker.isWindowOpen("+5210000000001")).toBe(false);

    const client = new WhatsAppClient({ ...VALID, windowTracker: tracker });
    const tpl = buildTemplate({
      to: "+5210000000001",
      name: "hello_world",
      language: "en_US",
    });

    await client.sendReply("wamid.original.HBg...", tpl, { retryPolicy: NO_RETRY });

    expect(capturedBody).not.toBeNull();
    const body = JSON.parse(capturedBody!) as {
      type: string;
      context?: { message_id?: string };
      template?: { name?: string };
    };
    expect(body.type).toBe("template");
    expect(body.context?.message_id).toBe("wamid.original.HBg...");
    expect(body.template?.name).toBe("hello_world");
  });

  it("a free-form payload via sendReply DOES consult the window tracker", async () => {
    server.use(
      http.post("https://graph.facebook.com/v25.0/PNID/messages", () =>
        HttpResponse.json({}, { status: 200 })
      )
    );

    const tracker = new WindowTracker({
      phoneNumberId: "PNID",
      storage: new InMemoryStorage(),
    });
    const client = new WhatsAppClient({ ...VALID, windowTracker: tracker });

    // Free-form text reply, window closed → expect WindowClosedError.
    await expect(
      client.sendReply(
        "wamid.original.HBg...",
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "+5210000000001",
          type: "text",
          text: { body: "hi" },
        },
        { retryPolicy: NO_RETRY }
      )
    ).rejects.toThrow(/window/i);
  });

  it("a reaction payload via sendReply is also window-exempt", async () => {
    let capturedBody: string | null = null;
    server.use(
      http.post("https://graph.facebook.com/v25.0/PNID/messages", async ({ request }) => {
        capturedBody = await request.text();
        return HttpResponse.json(
          {
            messaging_product: "whatsapp",
            contacts: [],
            messages: [{ id: "wamid.real-1" }],
          },
          { status: 200 }
        );
      })
    );

    const tracker = new WindowTracker({
      phoneNumberId: "PNID",
      storage: new InMemoryStorage(),
    });
    const client = new WhatsAppClient({ ...VALID, windowTracker: tracker });

    await client.sendReply(
      "wamid.original.HBg...",
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "+5210000000001",
        type: "reaction",
        reaction: { message_id: "wamid.original.HBg...", emoji: "👍" },
      },
      { retryPolicy: NO_RETRY }
    );

    expect(capturedBody).not.toBeNull();
    const body = JSON.parse(capturedBody!) as {
      type: string;
      context?: { message_id?: string };
    };
    expect(body.type).toBe("reaction");
    expect(body.context?.message_id).toBe("wamid.original.HBg...");
  });
});
