import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { InMemoryStorage } from "../../../src/storage/index.js";
import { WindowClosedError } from "../../../src/types/errors.js";
import { WindowTracker } from "../../../src/window/tracker.js";

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

function setupOkSendEndpoint(captures: { count: number }) {
  server.use(
    http.post("https://graph.facebook.com/v25.0/PNID/messages", () => {
      captures.count += 1;
      return HttpResponse.json(
        {
          messaging_product: "whatsapp",
          contacts: [{ input: TO, wa_id: TO }],
          messages: [{ id: "wamid.x" }],
        },
        { status: 200 }
      );
    })
  );
}

describe("WhatsAppClient with WindowTracker", () => {
  it("free-form sendText throws WindowClosedError when window is closed (no HTTP)", async () => {
    const captures = { count: 0 };
    setupOkSendEndpoint(captures);
    const tracker = new WindowTracker({ phoneNumberId: "PNID", storage: new InMemoryStorage() });
    const client = new WhatsAppClient({ ...VALID_OPTIONS, windowTracker: tracker });
    await expect(
      client.sendText({ to: TO, body: "hi" }, { retryPolicy: NO_RETRY })
    ).rejects.toBeInstanceOf(WindowClosedError);
    expect(captures.count).toBe(0);
  });

  it("free-form sendText goes through after notifyInbound opens the window", async () => {
    const captures = { count: 0 };
    setupOkSendEndpoint(captures);
    const tracker = new WindowTracker({ phoneNumberId: "PNID", storage: new InMemoryStorage() });
    const client = new WhatsAppClient({ ...VALID_OPTIONS, windowTracker: tracker });
    await tracker.notifyInbound(TO);
    const out = await client.sendText({ to: TO, body: "hi" }, { retryPolicy: NO_RETRY });
    expect(out.messages[0]?.id).toBe("wamid.x");
    expect(captures.count).toBe(1);
  });

  it("sendTemplate is window-exempt — fires HTTP even when window is closed", async () => {
    const captures = { count: 0 };
    setupOkSendEndpoint(captures);
    const tracker = new WindowTracker({ phoneNumberId: "PNID", storage: new InMemoryStorage() });
    const client = new WhatsAppClient({ ...VALID_OPTIONS, windowTracker: tracker });
    await client.sendTemplate(
      { to: TO, name: "hello_world", language: "en_US" },
      { retryPolicy: NO_RETRY }
    );
    expect(captures.count).toBe(1);
  });

  it("sendReaction is window-exempt", async () => {
    const captures = { count: 0 };
    setupOkSendEndpoint(captures);
    const tracker = new WindowTracker({ phoneNumberId: "PNID", storage: new InMemoryStorage() });
    const client = new WhatsAppClient({ ...VALID_OPTIONS, windowTracker: tracker });
    await client.sendReaction(
      { to: TO, messageId: "wamid.x", emoji: "👍" },
      { retryPolicy: NO_RETRY }
    );
    expect(captures.count).toBe(1);
  });

  it("sendReply is window-gated for free-form payloads", async () => {
    const captures = { count: 0 };
    setupOkSendEndpoint(captures);
    const tracker = new WindowTracker({ phoneNumberId: "PNID", storage: new InMemoryStorage() });
    const client = new WhatsAppClient({ ...VALID_OPTIONS, windowTracker: tracker });
    await expect(
      client.sendReply(
        "wamid.parent",
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: TO,
          type: "text",
          text: { body: "x" },
        },
        { retryPolicy: NO_RETRY }
      )
    ).rejects.toBeInstanceOf(WindowClosedError);
    expect(captures.count).toBe(0);
  });

  it("sendReply skips the gate for template payloads", async () => {
    const captures = { count: 0 };
    setupOkSendEndpoint(captures);
    const tracker = new WindowTracker({ phoneNumberId: "PNID", storage: new InMemoryStorage() });
    const client = new WhatsAppClient({ ...VALID_OPTIONS, windowTracker: tracker });
    await client.sendReply(
      "wamid.parent",
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: TO,
        type: "template",
        template: { name: "hello_world", language: { code: "en_US" } },
      },
      { retryPolicy: NO_RETRY }
    );
    expect(captures.count).toBe(1);
  });

  it("client.isWindowOpen returns true when no tracker is configured", async () => {
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    expect(await client.isWindowOpen(TO)).toBe(true);
  });

  it("client.isWindowOpen delegates to the tracker when configured", async () => {
    const tracker = new WindowTracker({ phoneNumberId: "PNID", storage: new InMemoryStorage() });
    const client = new WhatsAppClient({ ...VALID_OPTIONS, windowTracker: tracker });
    expect(await client.isWindowOpen(TO)).toBe(false);
    await tracker.notifyInbound(TO);
    expect(await client.isWindowOpen(TO)).toBe(true);
  });
});
