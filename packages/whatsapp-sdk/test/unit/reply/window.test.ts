// Parity with doji-agent test/whatsapp/reply-optout.test.ts (outboundMode).
import { describe, expect, it } from "vitest";

import { outboundMode, WINDOW_MARGIN_MS } from "../../../src/reply/index.js";
import { WINDOW_TTL_MS } from "../../../src/types/constants.js";

describe("outboundMode (24-hour window, templates)", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  const base = { now, optedOut: false, hasTemplate: true };

  it("defaults to a 5-minute margin", () => {
    expect(WINDOW_MARGIN_MS).toBe(5 * 60_000);
  });

  it("inside the window: any message", () => {
    expect(outboundMode({ ...base, lastInboundAt: now - 60_000 })).toBe("session");
    expect(
      outboundMode({ ...base, lastInboundAt: now - (WINDOW_TTL_MS - WINDOW_MARGIN_MS - 1) })
    ).toBe("session");
  });

  it("outside it (or within the safety margin): the template", () => {
    expect(outboundMode({ ...base, lastInboundAt: now - WINDOW_TTL_MS })).toBe("template");
    expect(outboundMode({ ...base, lastInboundAt: now - (WINDOW_TTL_MS - 60_000) })).toBe(
      "template"
    );
    expect(outboundMode({ ...base, lastInboundAt: null })).toBe("template");
    expect(outboundMode({ ...base, lastInboundAt: undefined })).toBe("template");
  });

  it("outside it, nothing for someone who opted out or when no template is configured", () => {
    expect(outboundMode({ ...base, lastInboundAt: now - 2 * WINDOW_TTL_MS, optedOut: true })).toBe(
      "drop"
    );
    expect(
      outboundMode({ ...base, lastInboundAt: now - 2 * WINDOW_TTL_MS, hasTemplate: false })
    ).toBe("drop");
    // inside the window an opted-out person who just wrote still gets the reply to that message
    expect(outboundMode({ ...base, lastInboundAt: now - 1000, optedOut: true })).toBe("session");
  });

  it("accepts Date values and a custom margin", () => {
    const last = new Date(now - (WINDOW_TTL_MS - 60_000));
    expect(outboundMode({ ...base, now: new Date(now), lastInboundAt: last })).toBe("template");
    expect(outboundMode({ ...base, now: new Date(now), lastInboundAt: last, marginMs: 0 })).toBe(
      "session"
    );
  });
});
