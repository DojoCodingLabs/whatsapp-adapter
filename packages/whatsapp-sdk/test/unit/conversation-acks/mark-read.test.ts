import { describe, expect, it } from "vitest";

import { buildMarkReadPayload } from "../../../src/conversation-acks/mark-read.js";
import { MockWhatsAppClient } from "../../../src/mock/client.js";

describe("buildMarkReadPayload", () => {
  it("builds the canonical status:read wire payload without typing by default", () => {
    expect(buildMarkReadPayload({ messageId: "wamid.HBgL..." })).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.HBgL...",
    });
  });

  it("attaches typing_indicator: { type: 'text' } when typing=true", () => {
    expect(buildMarkReadPayload({ messageId: "wamid.X", typing: true })).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.X",
      typing_indicator: { type: "text" },
    });
  });

  it("omits typing_indicator when typing=false explicitly", () => {
    const payload = buildMarkReadPayload({ messageId: "wamid.X", typing: false });
    expect(payload).not.toHaveProperty("typing_indicator");
  });

  it("rejects an empty messageId", () => {
    expect(() => buildMarkReadPayload({ messageId: "" })).toThrow(TypeError);
  });
});

describe("MockWhatsAppClient.markAsRead", () => {
  it("records each ack with the typing flag and clock timestamp", async () => {
    let t = 1_000;
    const m = new MockWhatsAppClient({
      phoneNumberId: "PNID",
      wabaId: "WABA",
      now: () => t,
    });
    await m.markAsRead({ messageId: "wamid.A" });
    t = 2_500;
    await m.markAsRead({ messageId: "wamid.B", typing: true });

    expect(m.markReads).toEqual([
      { messageId: "wamid.A", typing: false, at: 1_000 },
      { messageId: "wamid.B", typing: true, at: 2_500 },
    ]);
  });

  it("resolves with { success: true }", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    await expect(m.markAsRead({ messageId: "wamid.X" })).resolves.toEqual({
      success: true,
    });
  });

  it("reset() clears recorded acks", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    await m.markAsRead({ messageId: "wamid.X" });
    expect(m.markReads).toHaveLength(1);
    m.reset();
    expect(m.markReads).toHaveLength(0);
  });
});
