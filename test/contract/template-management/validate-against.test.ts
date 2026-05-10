import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import type { TemplateDefinition } from "../../../src/templates/types.js";
import { TemplateError } from "../../../src/types/errors.js";

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

const DEFINITION: TemplateDefinition = {
  id: "TPL",
  name: "appt_reminder",
  language: "en_US",
  category: "UTILITY",
  status: "APPROVED",
  components: [{ type: "BODY", text: "Hi {{1}}, your appointment is at {{2}}." }],
};

describe("client.sendTemplate with validateAgainst", () => {
  it("throws TemplateError on mismatch and NO HTTP fires", async () => {
    let calls = 0;
    server.use(
      http.post("https://graph.facebook.com/v23.0/PNID/messages", () => {
        calls += 1;
        return HttpResponse.json({}, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(
      client.sendTemplate(
        {
          to: TO,
          name: "appt_reminder",
          language: "en_US",
          components: [{ type: "body", parameters: [{ type: "text", text: "only-one-param" }] }],
          validateAgainst: DEFINITION,
        },
        { retryPolicy: NO_RETRY }
      )
    ).rejects.toBeInstanceOf(TemplateError);
    expect(calls).toBe(0);
  });

  it("matching definition lets the request through", async () => {
    let calls = 0;
    server.use(
      http.post("https://graph.facebook.com/v23.0/PNID/messages", () => {
        calls += 1;
        return HttpResponse.json(
          {
            messaging_product: "whatsapp",
            contacts: [{ input: TO, wa_id: TO }],
            messages: [{ id: "wamid.1" }],
          },
          { status: 200 }
        );
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const out = await client.sendTemplate(
      {
        to: TO,
        name: "appt_reminder",
        language: "en_US",
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Dani" },
              { type: "text", text: "10am" },
            ],
          },
        ],
        validateAgainst: DEFINITION,
      },
      { retryPolicy: NO_RETRY }
    );
    expect(out.messages[0]?.id).toBe("wamid.1");
    expect(calls).toBe(1);
  });

  it("without validateAgainst, the template send proceeds without local validation", async () => {
    let calls = 0;
    server.use(
      http.post("https://graph.facebook.com/v23.0/PNID/messages", () => {
        calls += 1;
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
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.sendTemplate(
      {
        to: TO,
        name: "appt_reminder",
        language: "en_US",
        // mismatched parameters — but no validateAgainst, so SDK doesn't check
        components: [{ type: "body", parameters: [{ type: "text", text: "only-one-param" }] }],
      },
      { retryPolicy: NO_RETRY }
    );
    expect(calls).toBe(1);
  });
});
