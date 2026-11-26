import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  MessageEvent,
  StatusEvent,
  UserPreferencesEvent,
  WebhookErrorEvent,
} from "../../../src/webhooks/events.js";
import { parseWebhookPayload } from "../../../src/webhooks/parser.js";

// Fixtures named `*-doc`, `bsuid-*`, `system-user-changed-user-id`,
// `audio-voice`, `interactive-product`, `template-quick-reply-button`
// and `status-*-bsuid*` are copied verbatim from Meta's webhook reference
// pages (fetched 2026-11-26). Inline payloads below are SYNTHESIZED from
// the documented syntax blocks where Meta ships no example.

const FIXTURES = fileURLToPath(new URL("../../__fixtures__/webhooks/", import.meta.url));

async function load(name: string): Promise<unknown> {
  return JSON.parse(await readFile(`${FIXTURES}${name}.json`, "utf8"));
}

function envelope(field: string, value: Record<string, unknown>): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field, value }] }],
  };
}

describe("parseWebhookPayload — BSUID / username identity", () => {
  it("surfaces fromUserId and the joined contact when the phone number is omitted", async () => {
    const [e] = parseWebhookPayload(await load("bsuid-username-text")) as MessageEvent[];
    expect(e?.kind).toBe("message");
    expect(e?.from).toBe("");
    expect(e?.fromUserId).toBe("US.13491208655302741918");
    expect(e?.fromParentUserId).toBeUndefined();
    expect(e?.contact).toEqual({
      userId: "US.13491208655302741918",
      username: "realsheenanelson",
      profileName: "Sheena Nelson",
    });
  });

  it("surfaces fromParentUserId and contact.parentUserId when parent BSUIDs are enabled", async () => {
    const [e] = parseWebhookPayload(await load("bsuid-parent-text")) as MessageEvent[];
    expect(e?.fromUserId).toBe("US.13491208655302741918");
    expect(e?.fromParentUserId).toBe("US.ENT.11815799212886844830");
    expect(e?.contact?.parentUserId).toBe("US.ENT.11815799212886844830");
  });

  it("joins the contact by wa_id when both phone and BSUID are present", async () => {
    const [e] = parseWebhookPayload(await load("audio-voice")) as MessageEvent[];
    expect(e?.from).toBe("16505551234");
    expect(e?.fromUserId).toBe("US.13491208655302741918");
    expect(e?.contact).toEqual({
      waId: "16505551234",
      userId: "US.13491208655302741918",
      profileName: "Sheena Nelson",
    });
  });

  it("joins the matching contact out of several by wa_id / user_id, never by position", () => {
    const events = parseWebhookPayload(
      envelope("messages", {
        contacts: [
          { profile: { name: "A" }, wa_id: "111", user_id: "US.A" },
          { profile: { name: "B" }, user_id: "US.B", identity_key_hash: "hash-b" },
        ],
        messages: [
          { from: "111", id: "wamid.a", timestamp: "1", type: "text", text: { body: "a" } },
          {
            from_user_id: "US.B",
            id: "wamid.b",
            timestamp: "1",
            type: "text",
            text: { body: "b" },
          },
          { from: "999", id: "wamid.c", timestamp: "1", type: "text", text: { body: "c" } },
        ],
      })
    ) as MessageEvent[];
    expect(events[0]?.contact?.profileName).toBe("A");
    expect(events[1]?.contact).toEqual({
      userId: "US.B",
      profileName: "B",
      identityKeyHash: "hash-b",
    });
    // No match among several contacts → no contact (never guess).
    expect(events[2]?.contact).toBeUndefined();
  });

  it("falls back to the contact user_id when messages[].from_user_id is absent", () => {
    const [e] = parseWebhookPayload(
      envelope("messages", {
        contacts: [{ profile: { name: "Solo" }, user_id: "US.SOLO" }],
        messages: [{ id: "wamid.s", timestamp: "1", type: "text", text: { body: "x" } }],
      })
    ) as MessageEvent[];
    expect(e?.fromUserId).toBe("US.SOLO");
    expect(e?.contact?.userId).toBe("US.SOLO");
  });

  it("legacy phone-only payloads keep the same shape (no BSUID keys invented)", async () => {
    const [e] = parseWebhookPayload(await load("text-inbound")) as MessageEvent[];
    expect(e?.from).not.toBe("");
    expect("fromUserId" in (e ?? {})).toBe(false);
    expect("groupId" in (e ?? {})).toBe(false);
  });
});

describe("parseWebhookPayload — documented subtypes and fields", () => {
  it("classifies interactive product as interactive_product, not unsupported", async () => {
    const [e] = parseWebhookPayload(await load("interactive-product")) as MessageEvent[];
    expect(e?.type).toBe("interactive_product");
  });

  it("classifies the template quick-reply button as button", async () => {
    const [e] = parseWebhookPayload(await load("template-quick-reply-button")) as MessageEvent[];
    expect(e?.type).toBe("button");
    expect(e?.contextId).toBe("wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=");
  });

  it("classifies coexistence edit and revoke messages", () => {
    const events = parseWebhookPayload(
      envelope("messages", {
        messages: [
          {
            from: "1",
            id: "wamid.e",
            timestamp: "1",
            type: "edit",
            edit: {
              original_message_id: "wamid.o",
              message: { type: "text", text: { body: "x" } },
            },
          },
          {
            from: "1",
            id: "wamid.r",
            timestamp: "1",
            type: "revoke",
            revoke: { original_message_id: "wamid.o" },
          },
        ],
      })
    ) as MessageEvent[];
    expect(events.map((e) => e.type)).toEqual(["edit", "revoke"]);
  });

  it("surfaces group_id on group messages", () => {
    const [e] = parseWebhookPayload(
      envelope("messages", {
        messages: [
          {
            from: "1",
            group_id: "GROUP-1",
            id: "wamid.g",
            timestamp: "1",
            type: "text",
            text: { body: "hi" },
          },
        ],
      })
    ) as MessageEvent[];
    expect(e?.groupId).toBe("GROUP-1");
  });

  it("surfaces messages[].errors on unsupported messages", () => {
    const [e] = parseWebhookPayload(
      envelope("messages", {
        messages: [
          {
            from: "1",
            id: "wamid.u",
            timestamp: "1",
            type: "unsupported",
            errors: [
              {
                code: 131051,
                title: "Message type unknown",
                message: "Message type unknown",
                error_data: { details: "Message type is currently not supported." },
              },
            ],
            unsupported: { type: "poll" },
          },
        ],
      })
    ) as MessageEvent[];
    expect(e?.type).toBe("unsupported");
    expect(e?.errors?.[0]?.code).toBe(131051);
    expect(e?.errors?.[0]?.error_data?.details).toBe("Message type is currently not supported.");
  });

  it("system messages expose no contact and keep from empty for user_changed_user_id", async () => {
    const [e] = parseWebhookPayload(await load("system-user-changed-user-id")) as MessageEvent[];
    expect(e?.type).toBe("system");
    expect(e?.from).toBe("");
    expect(e?.contact).toBeUndefined();
    // The NEW BSUID is surfaced as the sender identity.
    expect(e?.fromUserId).toBe("US.13491208655302741918");
  });
});

describe("parseWebhookPayload — value-level errors (bug: dropped silently)", () => {
  it("emits a webhook_error event when a messages change carries only value.errors", () => {
    const events = parseWebhookPayload(
      envelope("messages", {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "15550783881", phone_number_id: "PNID" },
        errors: [
          {
            code: 131000,
            title: "Something went wrong",
            message: "Something went wrong",
            error_data: { details: "Unknown error" },
            href: "https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/",
          },
        ],
      })
    );
    expect(events).toHaveLength(1);
    const e = events[0] as WebhookErrorEvent;
    expect(e.kind).toBe("webhook_error");
    expect(e.field).toBe("messages");
    expect(e.phoneNumberId).toBe("PNID");
    expect(e.errors[0]?.code).toBe(131000);
    expect(e.errors[0]?.href).toContain("error-codes");
  });

  it("still emits messages alongside value.errors", () => {
    const events = parseWebhookPayload(
      envelope("messages", {
        errors: [{ code: 1 }],
        messages: [{ from: "1", id: "wamid.x", timestamp: "1", type: "text", text: { body: "" } }],
      })
    );
    expect(events.map((e) => e.kind).sort()).toEqual(["message", "webhook_error"]);
  });

  it("ignores a non-array errors value and an empty array", () => {
    expect(parseWebhookPayload(envelope("messages", { errors: "nope" }))).toEqual([]);
    expect(parseWebhookPayload(envelope("messages", { errors: [] }))).toEqual([]);
  });
});

describe("parseWebhookPayload — status identity and pricing", () => {
  it("surfaces recipientUserId and the status-side contact", async () => {
    const [s] = parseWebhookPayload(await load("status-sent-marketing-bsuid")) as StatusEvent[];
    expect(s?.recipientId).toBe("16505551234");
    expect(s?.recipientUserId).toBe("US.13491208655302741918");
    expect(s?.contact).toEqual({
      waId: "16505551234",
      userId: "US.13491208655302741918",
      profileName: "Pablo M.",
    });
    expect(s?.pricingType).toBe("regular");
  });

  it("delivered status sent to a BSUID carries pricing and parent ids", async () => {
    const [s] = parseWebhookPayload(await load("status-delivered-bsuid-parent")) as StatusEvent[];
    expect(s?.status).toBe("delivered");
    expect(s?.recipientId).toBeUndefined();
    expect(s?.recipientUserId).toBe("US.13491208655302741918");
    expect(s?.recipientParentUserId).toBe("US.ENT.11815799212886844830");
    expect(s?.pricingCategory).toBe("marketing");
    expect(s?.contact?.username).toBe("pablomorales");
  });

  it("lifts pricing.subtype, biz_opaque_callback_data and typed errors (synthesized)", () => {
    const [s] = parseWebhookPayload(
      envelope("messages", {
        statuses: [
          {
            id: "wamid.s1",
            status: "sent",
            timestamp: "1",
            recipient_id: "1",
            biz_opaque_callback_data: "order-42",
            recipient_type: "individual",
            recipient_identity_key_hash: "khash",
            pricing: {
              billable: false,
              pricing_model: "PMP",
              type: "free_customer_service",
              category: "service",
              subtype: "free_tier",
            },
          },
        ],
      })
    ) as StatusEvent[];
    expect(s?.pricingSubtype).toBe("free_tier");
    expect(s?.bizOpaqueCallbackData).toBe("order-42");
    expect(s?.recipientType).toBe("individual");
    expect(s?.recipientIdentityKeyHash).toBe("khash");
  });

  it("types error_data.details and href on failed statuses", () => {
    const [s] = parseWebhookPayload(
      envelope("messages", {
        statuses: [
          {
            id: "wamid.f",
            status: "failed",
            timestamp: "1",
            recipient_user_id: "US.X",
            errors: [
              {
                code: 131049,
                title: "t",
                message: "m",
                error_data: { details: "d" },
                href: "https://example.com",
              },
            ],
          },
        ],
      })
    ) as StatusEvent[];
    expect(s?.errors?.[0]?.error_data?.details).toBe("d");
    expect(s?.errors?.[0]?.href).toBe("https://example.com");
    expect(s?.recipientUserId).toBe("US.X");
    expect(s?.contact).toBeUndefined();
  });
});

describe("parseWebhookPayload — user_preferences identity", () => {
  it("carries userId / parentUserId and leaves waId empty when Meta omits it", () => {
    const [p] = parseWebhookPayload(
      envelope("user_preferences", {
        user_preferences: [
          {
            user_id: "US.1",
            parent_user_id: "US.ENT.1",
            detail: "User requested to stop marketing messages",
            category: "marketing_messages",
            value: "stop",
            timestamp: 1735689601,
          },
        ],
      })
    ) as UserPreferencesEvent[];
    expect(p?.waId).toBe("");
    expect(p?.userId).toBe("US.1");
    expect(p?.parentUserId).toBe("US.ENT.1");
    expect(p?.timestamp).toBe(1735689601000);
  });

  it("falls back to the single contact's user_id", () => {
    const [p] = parseWebhookPayload(
      envelope("user_preferences", {
        contacts: [{ user_id: "US.C" }],
        user_preferences: [{ category: "marketing_messages", value: "resume", timestamp: 1 }],
      })
    ) as UserPreferencesEvent[];
    expect(p?.userId).toBe("US.C");
  });
});
