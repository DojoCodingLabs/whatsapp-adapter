import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  MessageEvent,
  StatusEvent,
  TemplateStatusEvent,
} from "../../../src/webhooks/events.js";
import { parseWebhookPayload } from "../../../src/webhooks/parser.js";

const FIXTURES = fileURLToPath(new URL("../../__fixtures__/webhooks/", import.meta.url));

async function load(name: string): Promise<unknown> {
  return JSON.parse(await readFile(`${FIXTURES}${name}.json`, "utf8"));
}

describe("parseWebhookPayload", () => {
  it("parses text-inbound into a single MessageEvent", async () => {
    const events = parseWebhookPayload(await load("text-inbound"));
    expect(events).toHaveLength(1);
    const e = events[0] as MessageEvent;
    expect(e.kind).toBe("message");
    expect(e.id).toBe("wamid.text-1");
    expect(e.from).toBe("521234567890");
    expect(e.type).toBe("text");
    expect(e.wabaId).toBe("WABA_ID");
    expect(e.phoneNumberId).toBe("PHONE_ID");
    expect(e.displayPhoneNumber).toBe("+15551234567");
    expect(e.timestamp).toBe(1735689600 * 1000);
  });

  it("normalises interactive button_reply → 'interactive_button_reply' and surfaces context.id", async () => {
    const events = parseWebhookPayload(await load("button-reply"));
    expect(events).toHaveLength(1);
    const e = events[0] as MessageEvent;
    expect(e.type).toBe("interactive_button_reply");
    expect(e.contextId).toBe("wamid.parent");
  });

  it("normalises interactive list_reply → 'interactive_list_reply'", async () => {
    const events = parseWebhookPayload(await load("list-reply"));
    expect((events[0] as MessageEvent).type).toBe("interactive_list_reply");
  });

  it("splits two messages into two events", async () => {
    const events = parseWebhookPayload(await load("two-messages"));
    expect(events).toHaveLength(2);
    expect((events[0] as MessageEvent).id).toBe("wamid.a");
    expect((events[1] as MessageEvent).id).toBe("wamid.b");
  });

  it("parses a sent status with conversation + pricing", async () => {
    const events = parseWebhookPayload(await load("status-sent"));
    const e = events[0] as StatusEvent;
    expect(e.kind).toBe("status");
    expect(e.id).toBe("wamid.sent-1");
    expect(e.status).toBe("sent");
    expect(e.recipientId).toBe("521234567890");
    expect(e.conversationId).toBe("conv-1");
    expect(e.pricingCategory).toBe("utility");
  });

  it("parses a failed status carrying errors[]", async () => {
    const events = parseWebhookPayload(await load("status-failed"));
    const e = events[0] as StatusEvent;
    expect(e.status).toBe("failed");
    expect(e.errors).toBeDefined();
    expect(e.errors!.length).toBe(1);
    expect(e.errors![0]?.code).toBe(131026);
  });

  it("parses message_template_status_update", async () => {
    const events = parseWebhookPayload(await load("template-status-approved"));
    const e = events[0] as TemplateStatusEvent;
    expect(e.kind).toBe("template_status");
    expect(e.templateId).toBe("TPL_ID");
    expect(e.event).toBe("APPROVED");
    expect(e.templateName).toBe("appointment_reminder");
    expect(e.language).toBe("en_US");
  });

  it("parses phone_number_quality_update", async () => {
    const events = parseWebhookPayload(await load("phone-quality-update"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "phone_number_quality", newQualityScore: "GREEN" });
  });

  it("surfaces unknown fields as kind:'unknown'", async () => {
    const events = parseWebhookPayload(await load("unknown-field"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "unknown",
      field: "smb_app_state_sync",
      wabaId: "WABA_ID",
    });
  });

  it("returns [] on a malformed envelope without throwing", () => {
    expect(parseWebhookPayload(null)).toEqual([]);
    expect(parseWebhookPayload(undefined)).toEqual([]);
    expect(parseWebhookPayload("not an object")).toEqual([]);
    expect(parseWebhookPayload({})).toEqual([]);
    expect(parseWebhookPayload({ entry: "wrong type" })).toEqual([]);
    expect(parseWebhookPayload({ entry: [{ changes: "wrong" }] })).toEqual([]);
  });

  it("parses message_template_quality_update", () => {
    const events = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "message_template_quality_update",
              value: {
                message_template_id: "TPL",
                message_template_name: "appointment",
                new_quality_score: "RED",
                previous_quality_score: "YELLOW",
              },
            },
          ],
        },
      ],
    });
    expect(events).toEqual([
      expect.objectContaining({
        kind: "template_quality",
        templateId: "TPL",
        templateName: "appointment",
        newQualityScore: "RED",
        previousQualityScore: "YELLOW",
      }),
    ]);
  });

  it("parses template_category_update", () => {
    const events = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "template_category_update",
              value: {
                message_template_id: "TPL",
                message_template_name: "promo",
                new_category: "MARKETING",
                previous_category: "UTILITY",
              },
            },
          ],
        },
      ],
    });
    expect(events[0]).toMatchObject({
      kind: "template_category",
      templateId: "TPL",
      templateName: "promo",
      newCategory: "MARKETING",
      previousCategory: "UTILITY",
    });
  });

  it("parses account_alerts and account_review_update", () => {
    const events = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "account_alerts",
              value: { alert_severity: "CRITICAL", alert_type: "QUALITY" },
            },
            { field: "account_review_update", value: { decision: "APPROVED" } },
          ],
        },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: "account_alert",
      alertSeverity: "CRITICAL",
      alertType: "QUALITY",
    });
    expect(events[1]).toMatchObject({ kind: "account_review", decision: "APPROVED" });
  });

  it("falls back to baseTimestamp when an inbound message has no timestamp", () => {
    const events = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                messages: [{ id: "wamid.x", from: "X", type: "text", text: { body: "hi" } }],
              },
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { timestamp: number }).timestamp).toBeGreaterThan(0);
  });

  it("handles timestamps already given in epoch milliseconds (numeric > 1e12)", () => {
    const events = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    id: "wamid.ms",
                    from: "X",
                    type: "text",
                    text: { body: "hi" },
                    timestamp: 1_700_000_000_000,
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect((events[0] as { timestamp: number }).timestamp).toBe(1_700_000_000_000);
  });

  it("normalises an unknown interactive sub-type to 'unsupported'", () => {
    const events = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    id: "wamid.flow",
                    from: "X",
                    type: "interactive",
                    interactive: { type: "flow_reply", flow_reply: {} },
                    timestamp: "1735689600",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect((events[0] as { type: string }).type).toBe("unsupported");
  });

  it("normalises an unknown top-level message type to 'unsupported'", () => {
    const events = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    id: "wamid.x",
                    from: "X",
                    type: "future_kind_we_dont_know",
                    timestamp: "1735689600",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect((events[0] as { type: string }).type).toBe("unsupported");
  });
});
