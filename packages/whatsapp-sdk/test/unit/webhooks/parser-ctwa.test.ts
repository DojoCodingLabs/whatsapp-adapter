import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { MessageEvent } from "../../../src/webhooks/events.js";
import { parseWebhookPayload } from "../../../src/webhooks/parser.js";

const FIXTURES = fileURLToPath(new URL("../../__fixtures__/webhooks/", import.meta.url));

async function load(name: string): Promise<unknown> {
  return JSON.parse(await readFile(`${FIXTURES}${name}.json`, "utf8"));
}

describe("parseWebhookPayload — referral / CTWA", () => {
  it("preserves the full documented referral payload on the MessageEvent", async () => {
    const events = parseWebhookPayload(await load("message-with-ctwa-referral"));
    expect(events).toHaveLength(1);
    const e = events[0] as MessageEvent;
    expect(e.kind).toBe("message");
    expect(e.referral).toBeDefined();
    expect(e.referral?.ctwa_clid).toBe("ARZxq-test-click-id");
    expect(e.referral?.source_url).toBe("https://fb.me/abc123");
    expect(e.referral?.source_type).toBe("ad");
    expect(e.referral?.source_id).toBe("1234567890");
    expect(e.referral?.headline).toBe("Try Site2Print today");
    expect(e.referral?.body).toBe("Order custom prints in minutes");
    expect(e.referral?.media_type).toBe("image");
    expect(e.referral?.media_url).toBe("https://scontent.example.com/ad.jpg");
    expect(e.referral?.thumbnail_url).toBe("https://scontent.example.com/ad-thumb.jpg");
  });

  it("preserves an empty referral object (`{}`) rather than dropping it", async () => {
    const events = parseWebhookPayload(await load("message-with-empty-referral"));
    expect(events).toHaveLength(1);
    const e = events[0] as MessageEvent;
    expect(e.referral).toBeDefined();
    expect(e.referral).toEqual({});
  });

  it("leaves referral undefined on a message without one", async () => {
    const events = parseWebhookPayload(await load("text-inbound"));
    expect(events).toHaveLength(1);
    const e = events[0] as MessageEvent;
    expect(e.referral).toBeUndefined();
  });

  it("preserves unknown future fields inside referral at runtime", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+15551234567",
                  phone_number_id: "PHONE_ID",
                },
                messages: [
                  {
                    from: "521234567890",
                    id: "wamid.future-1",
                    timestamp: "1735689600",
                    text: { body: "hi" },
                    type: "text",
                    referral: {
                      ctwa_clid: "x",
                      future_field_meta_adds_later: "some-value",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = parseWebhookPayload(payload);
    expect(events).toHaveLength(1);
    const e = events[0] as MessageEvent;
    expect(e.referral?.ctwa_clid).toBe("x");
    // Cast through to the runtime shape — the TS type doesn't name
    // `future_field_meta_adds_later`, but the value is preserved
    // verbatim because `referral` is a permissive intersection.
    expect(
      (e.referral as Record<string, unknown> | undefined)?.["future_field_meta_adds_later"]
    ).toBe("some-value");
  });

  it("does not throw on a non-object referral value (Meta-side malformed payload)", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+15551234567",
                  phone_number_id: "PHONE_ID",
                },
                messages: [
                  {
                    from: "521234567890",
                    id: "wamid.bad-ref",
                    timestamp: "1735689600",
                    text: { body: "hi" },
                    type: "text",
                    referral: "not-an-object",
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(() => parseWebhookPayload(payload)).not.toThrow();
    const events = parseWebhookPayload(payload);
    const e = events[0] as MessageEvent;
    expect(e.referral).toBeUndefined();
  });

  it("does not throw on a null referral value", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+15551234567",
                  phone_number_id: "PHONE_ID",
                },
                messages: [
                  {
                    from: "521234567890",
                    id: "wamid.null-ref",
                    timestamp: "1735689600",
                    text: { body: "hi" },
                    type: "text",
                    referral: null,
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(() => parseWebhookPayload(payload)).not.toThrow();
    const events = parseWebhookPayload(payload);
    const e = events[0] as MessageEvent;
    expect(e.referral).toBeUndefined();
  });
});
