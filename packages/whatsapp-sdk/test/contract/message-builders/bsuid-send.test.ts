import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { MockWhatsAppClient } from "../../../src/mock/client.js";
import type { WhatsAppLikeClient } from "../../../src/mock/types.js";
import { InMemoryOptInRegistry } from "../../../src/opt-in/in-memory.js";
import { InMemoryStorage } from "../../../src/storage/index.js";
import { OptOutError, TemplateError, WindowClosedError } from "../../../src/types/errors.js";
import { WindowTracker } from "../../../src/window/tracker.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const VALID = {
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

// Meta business-scoped-user-ids example values.
const BSUID = "US.13491208655302741918";
const PHONE = "15551234567";

function echo(): { bodies: unknown[] } {
  const state = { bodies: [] as unknown[] };
  server.use(
    http.post("https://graph.facebook.com/v26.0/PNID/messages", async ({ request }) => {
      state.bodies.push(await request.json());
      // Meta's BSUID send response: `user_id` set, `wa_id` omitted.
      return HttpResponse.json({
        messaging_product: "whatsapp",
        contacts: [{ input: BSUID, user_id: BSUID }],
        messages: [{ id: "wamid.real-1" }],
      });
    })
  );
  return state;
}

function clients(
  extra: { windowTracker?: WindowTracker; optInRegistry?: InMemoryOptInRegistry } = {}
): {
  real: WhatsAppClient;
  mock: MockWhatsAppClient;
} {
  return {
    real: new WhatsAppClient({ ...VALID, ...extra }),
    mock: new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA", ...extra }),
  };
}

describe("sending to a BSUID recipient", () => {
  it("real client POSTs `recipient` (no `to`); mock records the same payload and response shape", async () => {
    const wire = echo();
    const { real, mock } = clients();
    const realRes = await real.sendText(
      { recipient: BSUID, body: "hi" },
      { retryPolicy: NO_RETRY }
    );
    const mockRes = await mock.sendText({ recipient: BSUID, body: "hi" });

    expect(wire.bodies[0]).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      recipient: BSUID,
      type: "text",
      text: { body: "hi" },
    });
    expect(mock.sentMessages[0]?.payload).toEqual(wire.bodies[0]);
    expect(realRes.contacts[0]).toEqual({ input: BSUID, user_id: BSUID });
    expect(mockRes.contacts[0]).toEqual({ input: BSUID, user_id: BSUID });
  });

  it("the 24h window gate keys on the BSUID on both clients", async () => {
    const wire = echo();
    for (const make of [
      (t: WindowTracker): WhatsAppLikeClient => new WhatsAppClient({ ...VALID, windowTracker: t }),
      (t: WindowTracker): WhatsAppLikeClient =>
        new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA", windowTracker: t }),
    ]) {
      const tracker = new WindowTracker({ phoneNumberId: "PNID", storage: new InMemoryStorage() });
      const client = make(tracker);
      // Window opened for the phone number does not open it for the BSUID.
      await tracker.notifyInbound(PHONE);
      await expect(
        client.sendText({ recipient: BSUID, body: "hi" }, { retryPolicy: NO_RETRY })
      ).rejects.toBeInstanceOf(WindowClosedError);
      expect(await client.isWindowOpen(BSUID)).toBe(false);

      await tracker.notifyInbound(BSUID);
      await client.sendText({ recipient: BSUID, body: "hi" }, { retryPolicy: NO_RETRY });
      await client.sendReply(
        "wamid.in",
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          recipient: BSUID,
          type: "text",
          text: { body: "r" },
        },
        { retryPolicy: NO_RETRY }
      );
    }
    expect(wire.bodies).toHaveLength(2);
  });

  it("opt-in pre-flight keys on the BSUID on both clients", async () => {
    const wire = echo();
    const registry = new InMemoryOptInRegistry();
    await registry.optOut(BSUID, { category: "MARKETING" });
    const { real, mock } = clients({ optInRegistry: registry });
    for (const c of [real, mock] as WhatsAppLikeClient[]) {
      const err = await c
        .sendTemplate(
          { recipient: BSUID, name: "promo", language: "en_US" },
          { retryPolicy: NO_RETRY }
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OptOutError);
      expect((err as OptOutError).message).not.toContain(BSUID);
    }
    expect(wire.bodies).toHaveLength(0);
  });

  it("sendAuthTemplate rejects a BSUID recipient before any HTTP on both clients", async () => {
    const wire = echo();
    const { real, mock } = clients();
    for (const c of [real, mock] as WhatsAppLikeClient[]) {
      await expect(
        c.sendAuthTemplate(
          { recipient: BSUID, name: "verification_code", language: "en_US", otp: "123" } as never,
          { retryPolicy: NO_RETRY }
        )
      ).rejects.toBeInstanceOf(TemplateError);
    }
    expect(wire.bodies).toHaveLength(0);
  });
});
