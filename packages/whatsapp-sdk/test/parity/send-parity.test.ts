import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../src/client/whatsapp-client.js";
import { MockWhatsAppClient } from "../../src/mock/client.js";
import type { WhatsAppLikeClient } from "../../src/mock/types.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const PNID = "PNID";
const WABA = "WABA";
const TO = "521234567890";

const REAL_OPTIONS = {
  phoneNumberId: PNID,
  wabaId: WABA,
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

function setupHttpEcho() {
  let lastBody: string | null = null;
  server.use(
    http.post("https://graph.facebook.com/v25.0/PNID/messages", async ({ request }) => {
      lastBody = await request.text();
      return HttpResponse.json(
        {
          messaging_product: "whatsapp",
          contacts: [{ input: TO, wa_id: TO }],
          messages: [{ id: "wamid.real-1" }],
        },
        { status: 200 }
      );
    })
  );
  return () => lastBody;
}

interface ParityCase {
  name: string;
  run: (client: WhatsAppLikeClient) => Promise<unknown>;
  /** The wire `type` the SDK should produce for this scenario. */
  expectedType: string;
}

const PARITY_CASES: ReadonlyArray<ParityCase> = [
  {
    name: "sendText",
    run: (c) => c.sendText({ to: TO, body: "hi" }, { retryPolicy: NO_RETRY }),
    expectedType: "text",
  },
  {
    name: "sendImage",
    run: (c) =>
      c.sendImage({ to: TO, link: "https://example.com/cat.png" }, { retryPolicy: NO_RETRY }),
    expectedType: "image",
  },
  {
    name: "sendLocation",
    run: (c) => c.sendLocation({ to: TO, latitude: 0, longitude: 0 }, { retryPolicy: NO_RETRY }),
    expectedType: "location",
  },
  {
    name: "sendTemplate",
    run: (c) =>
      c.sendTemplate({ to: TO, name: "hello_world", language: "en_US" }, { retryPolicy: NO_RETRY }),
    expectedType: "template",
  },
  {
    name: "sendReaction",
    run: (c) =>
      c.sendReaction({ to: TO, messageId: "wamid.x", emoji: "👍" }, { retryPolicy: NO_RETRY }),
    expectedType: "reaction",
  },
  {
    name: "sendAuthTemplate",
    run: (c) =>
      c.sendAuthTemplate(
        { to: TO, name: "verification_code", language: "en_US", otp: "1234" },
        { retryPolicy: NO_RETRY }
      ),
    expectedType: "template",
  },
  {
    name: "sendVoice",
    run: (c) => c.sendVoice({ to: TO, id: "mid" }, { retryPolicy: NO_RETRY }),
    expectedType: "audio",
  },
  {
    name: "sendCarouselTemplate",
    run: (c) =>
      c.sendCarouselTemplate(
        {
          to: TO,
          name: "promo",
          language: "en_US",
          cards: [{ header: { type: "image", mediaId: "img" } }],
        },
        { retryPolicy: NO_RETRY }
      ),
    expectedType: "template",
  },
];

describe("parity: real and mock clients produce the same wire type per send", () => {
  for (const c of PARITY_CASES) {
    it(`${c.name} produces type=${c.expectedType} on both clients`, async () => {
      // Real client (msw observes the wire body)
      const captureBody = setupHttpEcho();
      const real = new WhatsAppClient({ ...REAL_OPTIONS });
      await c.run(real);
      const realBody = captureBody();
      expect(realBody).not.toBeNull();
      const realType = (JSON.parse(realBody!) as { type: string }).type;

      // Mock client
      const mock = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
      await c.run(mock);
      const mockType = mock.sentMessages[0]?.payload.type;

      expect(realType).toBe(c.expectedType);
      expect(mockType).toBe(c.expectedType);
    });
  }

  it("validation errors are equivalent across clients (empty body throws on both)", async () => {
    const real = new WhatsAppClient({ ...REAL_OPTIONS });
    await expect(real.sendText({ to: TO, body: "" }, { retryPolicy: NO_RETRY })).rejects.toThrow();
    const mock = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    await expect(mock.sendText({ to: TO, body: "" })).rejects.toThrow();
  });
});
