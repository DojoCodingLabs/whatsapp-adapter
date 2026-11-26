import { describe, expect, it, vi } from "vitest";

import { WEBHOOK_DEDUPE_TTL_MS } from "../../../src/types/constants.js";
import { WebhookDeduper } from "../../../src/webhooks/dedupe.js";
import type { UserPreferencesEvent, WebhookErrorEvent } from "../../../src/webhooks/events.js";
import { parseWebhookPayload } from "../../../src/webhooks/parser.js";
import { WebhookReceiver } from "../../../src/webhooks/receiver.js";

function envelope(field: string, value: Record<string, unknown>): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field, value }] }],
  };
}

describe("WebhookReceiver — user_preferences dedupe keys on BSUID", () => {
  it("does not collapse two username-only users who opt out in the same second", async () => {
    const r = new WebhookReceiver({ appSecret: "s", verifyToken: "v" });
    const handler = vi.fn();
    r.on("user_preferences", handler);
    const pref = (userId: string): Record<string, unknown> => ({
      user_id: userId,
      category: "marketing_messages",
      value: "stop",
      timestamp: 1735689601,
    });
    await r._dispatchEvents(
      parseWebhookPayload(envelope("user_preferences", { user_preferences: [pref("US.A")] }))
    );
    await r._dispatchEvents(
      parseWebhookPayload(envelope("user_preferences", { user_preferences: [pref("US.B")] }))
    );
    expect(handler).toHaveBeenCalledTimes(2);
    const ids = handler.mock.calls.map((c) => (c[0] as UserPreferencesEvent).userId);
    expect(ids).toEqual(["US.A", "US.B"]);
  });

  it("still dedupes a replay of the same BSUID-only preference change", async () => {
    const r = new WebhookReceiver({ appSecret: "s", verifyToken: "v" });
    const handler = vi.fn();
    r.on("user_preferences", handler);
    const payload = envelope("user_preferences", {
      user_preferences: [
        { user_id: "US.A", category: "marketing_messages", value: "stop", timestamp: 1 },
      ],
    });
    await r._dispatchEvents(parseWebhookPayload(payload));
    await r._dispatchEvents(parseWebhookPayload(payload));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("WebhookReceiver — webhook_error dispatch", () => {
  it("dispatches value-level errors to a typed handler", async () => {
    const r = new WebhookReceiver({ appSecret: "s", verifyToken: "v" });
    const handler = vi.fn();
    r.on("webhook_error", handler);
    await r._dispatchEvents(
      parseWebhookPayload(envelope("messages", { errors: [{ code: 131000, title: "x" }] }))
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0]?.[0] as WebhookErrorEvent).errors[0]?.code).toBe(131000);
  });
});

describe("dedupe TTL default", () => {
  it("covers Meta's 7-day redelivery window", () => {
    expect(WEBHOOK_DEDUPE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("a redelivery 6 days later is still a duplicate under the default TTL", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
      const { InMemoryStorage } = await import("../../../src/storage/index.js");
      const d = new WebhookDeduper(new InMemoryStorage());
      expect(await d.markIfNew("msg:wamid.late")).toBe(true);
      vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
      expect(await d.markIfNew("msg:wamid.late")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
