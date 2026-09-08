import { describe, expect, it } from "vitest";

import { defaultAgentTransform } from "../../../src/agent-bridge/transform.js";
import type { MessageEvent } from "../../../src/webhooks/events.js";

function baseEvent(overrides: Partial<MessageEvent> = {}): MessageEvent {
  return {
    kind: "message",
    wabaId: "WABA",
    timestamp: 1_700_000_000_000,
    id: "wamid.HBg...",
    from: "+5210000000001",
    type: "text",
    body: { text: { body: "hola" } },
    ...overrides,
  };
}

describe("defaultAgentTransform", () => {
  it("extracts body text from a text message", () => {
    const task = defaultAgentTransform(baseEvent());
    expect(task.text).toBe("hola");
    expect(task.type).toBe("text");
    expect(task.mediaIds).toBeUndefined();
  });

  it("preserves the raw event as the escape hatch", () => {
    const event = baseEvent();
    const task = defaultAgentTransform(event);
    expect(task.raw).toBe(event);
  });

  it("propagates wabaPhoneNumberId from event.phoneNumberId", () => {
    const event = baseEvent({ phoneNumberId: "PNID-1" });
    const task = defaultAgentTransform(event);
    expect(task.wabaPhoneNumberId).toBe("PNID-1");
  });

  it("propagates replyToWamid from event.contextId", () => {
    const event = baseEvent({ contextId: "wamid.parent" });
    const task = defaultAgentTransform(event);
    expect(task.replyToWamid).toBe("wamid.parent");
  });

  it.each([
    ["image", "media-img-1"],
    ["video", "media-vid-1"],
    ["audio", "media-aud-1"],
    ["document", "media-doc-1"],
    ["sticker", "media-sti-1"],
  ] as const)("extracts the media id for a %s message", (type, id) => {
    const event = baseEvent({
      type,
      body: { [type]: { id } },
    });
    const task = defaultAgentTransform(event);
    expect(task.mediaIds).toEqual([id]);
    expect(task.type).toBe(type);
  });

  it("extracts buttonReplyId for interactive_button_reply", () => {
    const event = baseEvent({
      type: "interactive_button_reply",
      body: { interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes" } } },
    });
    const task = defaultAgentTransform(event);
    expect(task.buttonReplyId).toBe("yes");
  });

  it("extracts listReplyId for interactive_list_reply", () => {
    const event = baseEvent({
      type: "interactive_list_reply",
      body: {
        interactive: { type: "list_reply", list_reply: { id: "row-3", title: "Tour 3" } },
      },
    });
    const task = defaultAgentTransform(event);
    expect(task.listReplyId).toBe("row-3");
  });

  it("extracts location coordinates and optional name/address", () => {
    const event = baseEvent({
      type: "location",
      body: {
        location: {
          latitude: 9.9341,
          longitude: -84.0877,
          name: "Plaza de la Cultura",
          address: "San José, CR",
        },
      },
    });
    const task = defaultAgentTransform(event);
    expect(task.location).toEqual({
      latitude: 9.9341,
      longitude: -84.0877,
      name: "Plaza de la Cultura",
      address: "San José, CR",
    });
  });

  it("propagates CTWA referral verbatim when present", () => {
    const referral = {
      ctwa_clid: "click-abc",
      source_url: "https://fb.com/ads/123",
      source_type: "ad",
    };
    const event = baseEvent({ referral });
    const task = defaultAgentTransform(event);
    expect(task.ctwaReferral).toBe(referral);
  });

  it("produces a task for unsupported types with raw event preserved", () => {
    const event = baseEvent({ type: "unsupported", body: { some: "weird-shape" } });
    const task = defaultAgentTransform(event);
    expect(task.type).toBe("unsupported");
    expect(task.text).toBeUndefined();
    expect(task.mediaIds).toBeUndefined();
    expect(task.raw).toBe(event);
  });

  it("defaults conversationId to from", () => {
    const task = defaultAgentTransform(baseEvent({ from: "+5210000000099" }));
    expect(task.conversationId).toBe("+5210000000099");
  });
});
