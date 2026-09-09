import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  MessageEvent,
  StatusEvent,
  TemplateStatusEvent,
  UserPreferencesEvent,
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

  it("normalises interactive nfm_reply (WhatsApp Flows completion) → 'interactive_nfm_reply'", async () => {
    const events = parseWebhookPayload(await load("interactive-nfm-reply"));
    expect(events).toHaveLength(1);
    const e = events[0] as MessageEvent;
    expect(e.type).toBe("interactive_nfm_reply");
    expect(e.contextId).toBe("wamid.flow-parent");
    const interactive = e.body["interactive"] as { nfm_reply: { response_json: string } };
    expect(JSON.parse(interactive.nfm_reply.response_json)).toMatchObject({
      flow_token: "tok-123",
      slot: "10:00",
    });
  });

  it("parses type 'request_welcome' (CTWA conversation opened) as its own kind, with referral", async () => {
    const events = parseWebhookPayload(await load("request-welcome"));
    expect(events).toHaveLength(1);
    const e = events[0] as MessageEvent;
    expect(e.type).toBe("request_welcome");
    expect(e.id).toBe("wamid.welcome-1");
    expect(e.referral?.ctwa_clid).toBe("CLICK_ID");
  });

  it("parses the user_preferences field into UserPreferencesEvent(s)", async () => {
    const events = parseWebhookPayload(await load("user-preferences-stop"));
    expect(events).toHaveLength(1);
    const e = events[0] as UserPreferencesEvent;
    expect(e).toMatchObject({
      kind: "user_preferences",
      wabaId: "WABA_ID",
      phoneNumberId: "PHONE_ID",
      displayPhoneNumber: "+15551234567",
      waId: "521234567890",
      category: "marketing_messages",
      value: "stop",
      detail: "User requested to stop marketing messages",
    });
    expect(e.timestamp).toBe(1735689601 * 1000);
    expect(e.raw).toMatchObject({ value: "stop" });
  });

  it("user_preferences: falls back to contacts[0].wa_id and emits one event per entry", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID",
          changes: [
            {
              field: "user_preferences",
              value: {
                messaging_product: "whatsapp",
                contacts: [{ wa_id: "5219999" }],
                user_preferences: [
                  { category: "marketing_messages", value: "stop", timestamp: 1735689601 },
                  { category: "marketing_messages", value: "resume", timestamp: 1735689700 },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = parseWebhookPayload(payload) as UserPreferencesEvent[];
    expect(events).toHaveLength(2);
    expect(events[0]?.waId).toBe("5219999");
    expect(events[0]?.value).toBe("stop");
    expect(events[1]?.value).toBe("resume");
    expect(events[1]?.detail).toBeUndefined();
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
    expect(e.pricingModel).toBe("CBP");
    expect(e.billable).toBe(true);
    expect(e.pricingType).toBeUndefined();
  });

  it("parses a per-message-pricing status without a conversation object", async () => {
    const events = parseWebhookPayload(await load("status-sent-pmp"));
    const e = events[0] as StatusEvent;
    expect(e.kind).toBe("status");
    expect(e.conversationId).toBeUndefined();
    expect(e.pricingModel).toBe("PMP");
    expect(e.pricingCategory).toBe("service");
    expect(e.pricingType).toBe("free_customer_service");
    expect(e.billable).toBe(false);
  });

  it("omits pricing fields entirely when the status carries no pricing object", async () => {
    const events = parseWebhookPayload(await load("status-failed"));
    const e = events[0] as StatusEvent;
    expect("pricingType" in e).toBe(false);
    expect("pricingModel" in e).toBe(false);
    expect("billable" in e).toBe(false);
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
