import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { InMemoryStorage } from "../../../src/storage/index.js";
import { WhatsAppError, WindowClosedError } from "../../../src/types/errors.js";
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

const MESSAGES_URL = "https://graph.facebook.com/v26.0/PNID/messages";

describe("WhatsAppClient.markAsRead (HTTP contract)", () => {
  it("POSTs { messaging_product, status: read, message_id } to /{phone-number-id}/messages", async () => {
    let body: unknown = null;
    server.use(
      http.post(MESSAGES_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const res = await client.markAsRead({ messageId: "wamid.ABC" }, { retryPolicy: NO_RETRY });
    expect(res).toEqual({ success: true });
    expect(body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.ABC",
    });
  });

  it("adds typing_indicator: { type: text } when typing is true", async () => {
    let body: unknown = null;
    server.use(
      http.post(MESSAGES_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.markAsRead({ messageId: "wamid.ABC", typing: true }, { retryPolicy: NO_RETRY });
    expect(body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.ABC",
      typing_indicator: { type: "text" },
    });
  });

  it("is window-independent: succeeds when the tracker reports the window closed", async () => {
    server.use(
      http.post(MESSAGES_URL, () => HttpResponse.json({ success: true }, { status: 200 }))
    );
    const windowTracker = new WindowTracker({
      phoneNumberId: "PNID",
      storage: new InMemoryStorage(),
    });
    const client = new WhatsAppClient({ ...VALID_OPTIONS, windowTracker });
    // Free-form send is gated…
    await expect(
      client.sendText({ to: "521234567890", body: "hi" }, { retryPolicy: NO_RETRY })
    ).rejects.toBeInstanceOf(WindowClosedError);
    // …but the read receipt is not.
    await expect(
      client.markAsRead({ messageId: "wamid.ABC" }, { retryPolicy: NO_RETRY })
    ).resolves.toEqual({ success: true });
  });

  it("rejects an empty messageId with WhatsAppError(UNKNOWN) before any HTTP call", async () => {
    let hits = 0;
    server.use(
      http.post(MESSAGES_URL, () => {
        hits += 1;
        return HttpResponse.json({ success: true }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    let err: unknown;
    try {
      await client.markAsRead({ messageId: "" }, { retryPolicy: NO_RETRY });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as WhatsAppError).code).toBe("UNKNOWN");
    expect(hits).toBe(0);
  });

  it("maps a Meta error body through mapMetaError", async () => {
    server.use(
      http.post(MESSAGES_URL, () =>
        HttpResponse.json(
          { error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 } },
          { status: 401 }
        )
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const err = await client
      .markAsRead({ messageId: "wamid.ABC" }, { retryPolicy: NO_RETRY })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect((err as WhatsAppError).code).toBe("AUTHENTICATION");
  });
});
