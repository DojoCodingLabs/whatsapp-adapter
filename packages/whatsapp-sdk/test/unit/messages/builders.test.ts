import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildAudio,
  buildContacts,
  buildDocument,
  buildImage,
  buildInteractive,
  buildInteractiveButton,
  buildInteractiveCtaUrl,
  buildInteractiveList,
  buildLocation,
  buildReaction,
  buildSticker,
  buildTemplate,
  buildText,
  buildVideo,
} from "../../../src/messages/builders.js";
import { TemplateError, WhatsAppError } from "../../../src/types/errors.js";

const FIXTURE_DIR = fileURLToPath(new URL("../../__fixtures__/messages/", import.meta.url));

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(`${FIXTURE_DIR}${name}.json`, "utf8"));
}

const TO = "521234567890";

describe("buildText", () => {
  it("matches the text fixture", async () => {
    expect(buildText({ to: TO, body: "Hello from the adapter" })).toEqual(
      await loadFixture("text")
    );
  });

  it("emits preview_url when set", async () => {
    expect(buildText({ to: TO, body: "see https://example.com", previewUrl: true })).toEqual(
      await loadFixture("text-preview-url")
    );
  });

  it("attaches context.message_id when replyTo is provided", async () => {
    expect(buildText({ to: TO, body: "ack", replyTo: "wamid.xyz" })).toEqual(
      await loadFixture("text-reply")
    );
  });

  it("rejects empty body", () => {
    expect(() => buildText({ to: TO, body: "" })).toThrow(WhatsAppError);
  });

  it("rejects empty to", () => {
    expect(() => buildText({ to: "", body: "hi" })).toThrow(WhatsAppError);
  });

  it("rejects empty replyTo", () => {
    expect(() => buildText({ to: TO, body: "hi", replyTo: "" })).toThrow(WhatsAppError);
  });
});

describe("buildImage", () => {
  it("matches the image-link fixture", async () => {
    expect(buildImage({ to: TO, link: "https://example.com/cat.png", caption: "cat" })).toEqual(
      await loadFixture("image-link")
    );
  });

  it("rejects neither id nor link", () => {
    expect(() => buildImage({ to: TO })).toThrow(WhatsAppError);
  });

  it("rejects both id and link", () => {
    expect(() => buildImage({ to: TO, id: "abc", link: "https://x" })).toThrow(WhatsAppError);
  });
});

describe("buildVideo / buildAudio / buildSticker / buildDocument", () => {
  it("buildVideo with id only", () => {
    const out = buildVideo({ to: TO, id: "media-id-123" });
    expect(out.video).toEqual({ id: "media-id-123" });
  });

  it("buildAudio strips caption/filename and accepts id-only", () => {
    const out = buildAudio({ to: TO, id: "abc", caption: "ignored", filename: "ignored" });
    expect(out.audio).toEqual({ id: "abc" });
  });

  it("buildSticker accepts link", () => {
    const out = buildSticker({ to: TO, link: "https://example.com/s.webp" });
    expect(out.sticker).toEqual({ link: "https://example.com/s.webp" });
  });

  it("buildDocument matches the document fixture (preserves filename)", async () => {
    expect(
      buildDocument({
        to: TO,
        link: "https://example.com/contract.pdf",
        caption: "Please sign by EOD",
        filename: "contract.pdf",
      })
    ).toEqual(await loadFixture("document"));
  });
});

describe("buildLocation", () => {
  it("matches the location fixture", async () => {
    expect(
      buildLocation({
        to: TO,
        latitude: 19.4326,
        longitude: -99.1332,
        name: "Zócalo",
        address: "Centro Histórico, CDMX",
      })
    ).toEqual(await loadFixture("location"));
  });

  it("rejects out-of-range latitude", () => {
    expect(() => buildLocation({ to: TO, latitude: 91, longitude: 0 })).toThrow(WhatsAppError);
  });

  it("rejects out-of-range longitude", () => {
    expect(() => buildLocation({ to: TO, latitude: 0, longitude: -180.5 })).toThrow(WhatsAppError);
  });

  it("rejects NaN latitude", () => {
    expect(() => buildLocation({ to: TO, latitude: Number.NaN, longitude: 0 })).toThrow(
      WhatsAppError
    );
  });
});

describe("buildContacts", () => {
  it("accepts a single Contact and matches the fixture", async () => {
    expect(
      buildContacts({
        to: TO,
        contacts: {
          name: { formatted_name: "Jane Doe", first_name: "Jane", last_name: "Doe" },
          phones: [{ phone: "+52 55 1234 5678", type: "CELL", wa_id: "5215512345678" }],
        },
      })
    ).toEqual(await loadFixture("contacts"));
  });

  it("rejects an empty array", () => {
    expect(() => buildContacts({ to: TO, contacts: [] })).toThrow(WhatsAppError);
  });

  it("rejects a contact with no formatted_name", () => {
    expect(() => buildContacts({ to: TO, contacts: { name: { formatted_name: "" } } })).toThrow(
      WhatsAppError
    );
  });
});

describe("buildInteractiveButton", () => {
  it("matches the interactive-button fixture", async () => {
    expect(
      buildInteractiveButton({
        to: TO,
        body: "Pick one",
        buttons: [
          { id: "yes", title: "Yes" },
          { id: "no", title: "No" },
        ],
      })
    ).toEqual(await loadFixture("interactive-button"));
  });

  it("rejects 4 buttons", () => {
    expect(() =>
      buildInteractiveButton({
        to: TO,
        body: "x",
        buttons: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
          { id: "c", title: "C" },
          { id: "d", title: "D" },
        ],
      })
    ).toThrow(WhatsAppError);
  });

  it("rejects 0 buttons", () => {
    expect(() => buildInteractiveButton({ to: TO, body: "x", buttons: [] })).toThrow(WhatsAppError);
  });
});

describe("buildInteractiveList", () => {
  it("matches the interactive-list fixture", async () => {
    expect(
      buildInteractiveList({
        to: TO,
        body: "Choose a service",
        button: "Browse",
        sections: [
          {
            title: "Haircuts",
            rows: [
              { id: "cut-short", title: "Short cut", description: "30 min" },
              { id: "cut-fade", title: "Fade", description: "45 min" },
            ],
          },
        ],
      })
    ).toEqual(await loadFixture("interactive-list"));
  });

  it("rejects an empty section", () => {
    expect(() =>
      buildInteractiveList({
        to: TO,
        body: "x",
        button: "Browse",
        sections: [{ title: "S", rows: [] }],
      })
    ).toThrow(WhatsAppError);
  });
});

describe("buildInteractiveCtaUrl", () => {
  it("matches the interactive-cta-url fixture", async () => {
    expect(
      buildInteractiveCtaUrl({
        to: TO,
        body: "Check our menu",
        cta: { displayText: "View menu", url: "https://example.com/menu" },
      })
    ).toEqual(await loadFixture("interactive-cta-url"));
  });

  it("rejects an invalid URL", () => {
    expect(() =>
      buildInteractiveCtaUrl({
        to: TO,
        body: "x",
        cta: { displayText: "go", url: "not a url" },
      })
    ).toThrow(WhatsAppError);
  });
});

describe("buildInteractive (dispatcher)", () => {
  it("dispatches by `kind`", () => {
    const button = buildInteractive({
      kind: "button",
      to: TO,
      body: "x",
      buttons: [{ id: "a", title: "A" }],
    });
    expect(button.interactive.type).toBe("button");

    const list = buildInteractive({
      kind: "list",
      to: TO,
      body: "x",
      button: "Go",
      sections: [{ title: "S", rows: [{ id: "r", title: "R" }] }],
    });
    expect(list.interactive.type).toBe("list");

    const cta = buildInteractive({
      kind: "cta_url",
      to: TO,
      body: "x",
      cta: { displayText: "Open", url: "https://example.com" },
    });
    expect(cta.interactive.type).toBe("cta_url");
  });
});

describe("buildTemplate", () => {
  it("matches the template fixture", async () => {
    expect(
      buildTemplate({
        to: TO,
        name: "appointment_reminder",
        language: "en_US",
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Dani" },
              { type: "text", text: "tomorrow at 10am" },
            ],
          },
        ],
      })
    ).toEqual(await loadFixture("template"));
  });

  it("rejects empty name", () => {
    expect(() => buildTemplate({ to: TO, name: "", language: "en_US" })).toThrow(TemplateError);
  });

  it("rejects empty language", () => {
    expect(() => buildTemplate({ to: TO, name: "x", language: "" })).toThrow(TemplateError);
  });

  it("rejects an unknown component.type", () => {
    expect(() =>
      buildTemplate({
        to: TO,
        name: "x",
        language: "en_US",
        components: [{ type: "weird" as unknown as "header" }],
      })
    ).toThrow(TemplateError);
  });

  it("rejects a button component with no sub_type", () => {
    expect(() =>
      buildTemplate({
        to: TO,
        name: "x",
        language: "en_US",
        components: [{ type: "button" }],
      })
    ).toThrow(TemplateError);
  });
});

describe("buildReaction", () => {
  it("matches the reaction fixture", async () => {
    expect(buildReaction({ to: TO, messageId: "wamid.xyz", emoji: "👍" })).toEqual(
      await loadFixture("reaction")
    );
  });

  it("accepts empty emoji to clear", () => {
    expect(buildReaction({ to: TO, messageId: "wamid.xyz", emoji: "" }).reaction).toEqual({
      message_id: "wamid.xyz",
      emoji: "",
    });
  });

  it("rejects empty messageId", () => {
    expect(() => buildReaction({ to: TO, messageId: "", emoji: "👍" })).toThrow(WhatsAppError);
  });
});

describe("flow rejection (v1 non-goal)", () => {
  it("buildInteractive rejects kind=flow", () => {
    expect(() =>
      buildInteractive({
        kind: "flow" as unknown as "button",
        to: TO,
        body: "x",
        buttons: [{ id: "a", title: "A" }],
      })
    ).toThrow(WhatsAppError);
  });
});
