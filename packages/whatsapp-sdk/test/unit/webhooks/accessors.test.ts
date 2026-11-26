import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  messageIdentityChange,
  messageMedia,
  messageReferral,
  messageReplyId,
  messageSenderKey,
  messageText,
} from "../../../src/webhooks/accessors.js";
import type { MessageEvent } from "../../../src/webhooks/events.js";
import { parseWebhookPayload } from "../../../src/webhooks/parser.js";

const FIXTURES = fileURLToPath(new URL("../../__fixtures__/webhooks/", import.meta.url));

async function first(name: string): Promise<MessageEvent> {
  const parsed = JSON.parse(await readFile(`${FIXTURES}${name}.json`, "utf8")) as unknown;
  return parseWebhookPayload(parsed)[0] as MessageEvent;
}

function synth(body: Record<string, unknown>, extra: Partial<MessageEvent> = {}): MessageEvent {
  return {
    kind: "message",
    wabaId: "W",
    timestamp: 0,
    id: "wamid.x",
    from: "1",
    type: "unsupported",
    body,
    ...extra,
  };
}

describe("messageSenderKey", () => {
  it("prefers the phone number when present (stable for existing phone-keyed data)", async () => {
    expect(messageSenderKey(await first("audio-voice"))).toBe("16505551234");
  });

  it("falls back to the BSUID when the phone number is omitted", async () => {
    expect(messageSenderKey(await first("bsuid-username-text"))).toBe("US.13491208655302741918");
  });

  it("returns an empty string only when Meta sent neither identifier", () => {
    expect(messageSenderKey(synth({}, { from: "" }))).toBe("");
  });
});

describe("messageText", () => {
  it("reads text.body", async () => {
    expect(messageText(await first("bsuid-username-text"))).toBe("Does it come in another color?");
  });
  it("reads the template quick-reply button text", async () => {
    expect(messageText(await first("template-quick-reply-button"))).toBe("Unsubscribe");
  });
  it("reads interactive button_reply and list_reply titles", async () => {
    expect(messageText(await first("interactive-button-reply-doc"))).toBe("Cancel");
    expect(messageText(await first("interactive-list-reply-doc"))).toBe("Priority Mail Express");
  });
  it("returns undefined for media and malformed bodies", async () => {
    expect(messageText(await first("audio-voice"))).toBeUndefined();
    expect(messageText(synth({ text: "not-an-object" }))).toBeUndefined();
    expect(messageText(synth({ interactive: { type: "button_reply", button_reply: 5 } }))).toBe(
      undefined
    );
  });
});

describe("messageReplyId", () => {
  it("reads button_reply.id, list_reply.id and button.payload", async () => {
    expect(messageReplyId(await first("interactive-button-reply-doc"))).toBe("cancel-button");
    expect(messageReplyId(await first("interactive-list-reply-doc"))).toBe("priority_express");
    expect(messageReplyId(await first("template-quick-reply-button"))).toBe("Unsubscribe");
  });
  it("returns undefined for plain text", async () => {
    expect(messageReplyId(await first("bsuid-username-text"))).toBeUndefined();
  });
});

describe("messageMedia", () => {
  it("reads a voice note", async () => {
    expect(messageMedia(await first("audio-voice"))).toEqual({
      kind: "audio",
      id: "1908647269898587",
      mimeType: "audio/ogg; codecs=opus",
      sha256: "wvqXMe6n7n1W0zphvLPoLj+s/NtKqmr3zZ7YzTP7xFI=",
      url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=133...",
      voice: true,
    });
  });
  it("reads document caption + filename", () => {
    const e = synth(
      { document: { id: "D1", mime_type: "application/pdf", caption: "c", filename: "f.pdf" } },
      { type: "document" }
    );
    expect(messageMedia(e)).toEqual({
      kind: "document",
      id: "D1",
      mimeType: "application/pdf",
      caption: "c",
      filename: "f.pdf",
    });
  });
  it("returns undefined for non-media types or a missing id", () => {
    expect(messageMedia(synth({ text: { body: "x" } }, { type: "text" }))).toBeUndefined();
    expect(messageMedia(synth({ image: { mime_type: "x" } }, { type: "image" }))).toBeUndefined();
  });
});

describe("messageReferral", () => {
  it("normalises the current documented CTWA referral to camelCase", async () => {
    expect(messageReferral(await first("ctwa-referral-doc"))).toEqual({
      ctwaClid:
        "Aff-n8ZTODiE79d22KtAwQKj9e_mIEOOj27vDVwFjN80dp4_0NiNhEgpGo0AHemvuSoifXaytfTzcchptiErTKCqTrJ5nW1h7IHYeYymGb5K5J5iTROpBhWAGaIAeUzHL50",
      sourceId: "120226305854810726",
      sourceType: "ad",
      sourceUrl: "https://fb.me/3cr4Wqqkv",
      headline: "Chat with us",
      body: "Summer Succulents are here!",
      mediaType: "image",
      imageUrl: "https://scontent.xx.fbcdn.net/v/t45.1...",
      welcomeMessageText: "Hi there! Let us know how we can help!",
    });
  });
  it("tolerates a missing ctwa_clid (WhatsApp Status ads) and legacy media_url", () => {
    const r = messageReferral(
      synth({}, { referral: { source_type: "ad", media_type: "video", media_url: "u" } })
    );
    expect(r).toEqual({ sourceType: "ad", mediaType: "video", mediaUrl: "u" });
  });
  it("returns undefined without a referral and {} for an empty one", () => {
    expect(messageReferral(synth({}))).toBeUndefined();
    expect(messageReferral(synth({}, { referral: {} }))).toEqual({});
  });
});

describe("messageIdentityChange", () => {
  it("exposes previous and new BSUIDs for user_changed_user_id", async () => {
    expect(messageIdentityChange(await first("system-user-changed-user-id"))).toEqual({
      type: "user_changed_user_id",
      userId: "US.13491208655302741918",
      parentUserId: "US.ENT.506847293015824",
      previousUserId: "US.10230984751029384756",
      previousParentUserId: "US.ENT.918273645500112",
    });
  });
  it("exposes the new phone number for user_changed_number", () => {
    const e = synth(
      { system: { type: "user_changed_number", body: "b", wa_id: "222" } },
      { type: "system", from: "111" }
    );
    expect(messageIdentityChange(e)).toEqual({
      type: "user_changed_number",
      waId: "222",
      previousWaId: "111",
    });
  });
  it("returns undefined for non-system messages and unrelated system types", () => {
    expect(messageIdentityChange(synth({ text: { body: "x" } }, { type: "text" }))).toBe(undefined);
    expect(
      messageIdentityChange(
        synth({ system: { type: "customer_identity_changed" } }, { type: "system" })
      )
    ).toBeUndefined();
  });
});
