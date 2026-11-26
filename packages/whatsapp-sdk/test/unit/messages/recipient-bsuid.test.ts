import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildAuthTemplate,
  buildCarouselTemplate,
  buildImage,
  buildInteractiveCtaUrl,
  buildReaction,
  buildTemplate,
  buildText,
  isBsuid,
  recipientKeyOf,
} from "../../../src/messages/builders.js";
import { TemplateError, WhatsAppError } from "../../../src/types/errors.js";

const FIXTURE_DIR = fileURLToPath(new URL("../../__fixtures__/messages/", import.meta.url));
const loadFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(`${FIXTURE_DIR}${name}.json`, "utf8"));

// Example values from Meta's business-scoped-user-ids page.
const BSUID = "US.13491208655302741918";
const PARENT_BSUID = "US.ENT.11815799212886844830";
const PHONE = "521234567890";

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe("BSUID recipients (Meta `recipient` field)", () => {
  it("buildText({ recipient }) matches Meta's documented BSUID send shape", async () => {
    expect(buildText({ recipient: BSUID, body: "Hello from the adapter" })).toEqual(
      await loadFixture("text-bsuid")
    );
  });

  it("accepts a parent BSUID", () => {
    const msg = buildImage({ recipient: PARENT_BSUID, link: "https://example.com/a.png" });
    expect(msg.recipient).toBe(PARENT_BSUID);
    expect(msg).not.toHaveProperty("to");
  });

  it("phone sends never carry `recipient`", () => {
    const msg = buildText({ to: PHONE, body: "hi" });
    expect(msg.to).toBe(PHONE);
    expect(msg).not.toHaveProperty("recipient");
  });

  it("templates and carousels can be addressed by BSUID", () => {
    expect(
      buildTemplate({ recipient: BSUID, name: "hello_world", language: "en_US" })
    ).toMatchObject({ recipient: BSUID, type: "template" });
    expect(
      buildCarouselTemplate({
        recipient: BSUID,
        name: "promo",
        language: "en_US",
        cards: [{ header: { type: "image", mediaId: "1" } }],
      })
    ).toMatchObject({ recipient: BSUID });
  });

  it.each([
    ["neither", { body: "hi" }],
    ["both", { to: PHONE, recipient: BSUID, body: "hi" }],
  ])("rejects %s of to / recipient with WhatsAppError(UNKNOWN)", (_label, input) => {
    const err = thrown(() => buildText(input as never));
    expect(err).toBeInstanceOf(WhatsAppError);
    expect((err as WhatsAppError).code).toBe("UNKNOWN");
    expect((err as WhatsAppError).message).toMatch(/exactly one of `to`/);
  });

  it("rejects a malformed BSUID without echoing it", () => {
    const err = thrown(() => buildText({ recipient: "not-a-bsuid-555", body: "hi" }));
    expect(err).toBeInstanceOf(WhatsAppError);
    expect((err as WhatsAppError).message).not.toContain("not-a-bsuid-555");
  });

  it("rejects a BSUID passed as `to` (it would be sent as a phone number)", () => {
    const err = thrown(() => buildText({ to: BSUID, body: "hi" }));
    expect(err).toBeInstanceOf(WhatsAppError);
    expect((err as WhatsAppError).message).toMatch(/pass it as `recipient`/);
    expect((err as WhatsAppError).message).not.toContain(BSUID);
  });

  it("authentication templates reject BSUID recipients (Meta: require phone numbers, 131062)", () => {
    const err = thrown(() =>
      buildAuthTemplate({
        recipient: BSUID,
        name: "verification_code",
        language: "en_US",
        otp: "1234",
      } as never)
    );
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as TemplateError).message).toContain("131062");
    expect((err as TemplateError).message).not.toContain(BSUID);
  });

  it("isBsuid / recipientKeyOf", () => {
    expect(isBsuid(BSUID)).toBe(true);
    expect(isBsuid(PARENT_BSUID)).toBe(true);
    expect(isBsuid(PHONE)).toBe(false);
    expect(isBsuid(`US.${"a".repeat(129)}`)).toBe(false);
    expect(recipientKeyOf({ to: PHONE })).toBe(PHONE);
    expect(recipientKeyOf({ recipient: BSUID })).toBe(BSUID);
    expect(() => recipientKeyOf({})).toThrow(WhatsAppError);
  });
});

describe("cta_url requires https", () => {
  const base = { to: PHONE, body: "Go" };
  it.each(["javascript:alert(1)", "http://example.com", "data:text/html,hi", "ftp://x.example"])(
    "rejects %s with WhatsAppError(UNKNOWN)",
    (url) => {
      const err = thrown(() =>
        buildInteractiveCtaUrl({ ...base, cta: { displayText: "Open", url } })
      );
      expect(err).toBeInstanceOf(WhatsAppError);
      expect((err as WhatsAppError).code).toBe("UNKNOWN");
      expect((err as WhatsAppError).message).toMatch(/https: scheme/);
    }
  );
  it("accepts https", () => {
    const msg = buildInteractiveCtaUrl({
      ...base,
      cta: { displayText: "Open", url: "https://example.com/x?y=1" },
    });
    expect(msg.interactive.type).toBe("cta_url");
  });
});

describe("reactions cannot be contextual replies", () => {
  it("rejects replyTo with WhatsAppError(UNKNOWN)", () => {
    const err = thrown(() =>
      buildReaction({ to: PHONE, messageId: "wamid.x", emoji: "👍", replyTo: "wamid.y" } as never)
    );
    expect(err).toBeInstanceOf(WhatsAppError);
    expect((err as WhatsAppError).code).toBe("UNKNOWN");
    expect((err as WhatsAppError).message).toMatch(/contextual reply/);
  });
  it("never emits `context`", () => {
    expect(buildReaction({ to: PHONE, messageId: "wamid.x", emoji: "👍" })).not.toHaveProperty(
      "context"
    );
  });
});
