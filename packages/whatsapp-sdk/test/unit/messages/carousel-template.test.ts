import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildCarouselTemplate, type CarouselCard } from "../../../src/messages/builders.js";
import { TemplateError } from "../../../src/types/errors.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../__fixtures__/messages/carousel-template.json", import.meta.url)
);

async function loadFixture(): Promise<Record<string, unknown>> {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const { _source, _note, ...rest } = parsed as { _source?: unknown; _note?: unknown };
  void _source;
  void _note;
  return rest;
}

describe("buildCarouselTemplate", () => {
  it("produces Meta's documented carousel wire payload byte-for-byte", async () => {
    const fixture = await loadFixture();
    const built = buildCarouselTemplate({
      to: "16505555555",
      name: "carousel_template_media_cards_v1",
      language: "en_US",
      bodyParameters: ["Pablo", "30%"],
      cards: [
        {
          header: { type: "image", mediaId: "card-image-0" },
          buttons: [{ subType: "url", text: "BLUE_ELF" }],
        },
        {
          header: { type: "image", mediaId: "card-image-1" },
          buttons: [{ subType: "url", text: "BUDDHA" }],
        },
      ],
    });
    expect(built).toEqual(fixture);
  });

  it("rejects an empty cards array", () => {
    expect(() =>
      buildCarouselTemplate({
        to: "+1",
        name: "x",
        language: "en_US",
        cards: [],
      })
    ).toThrow(TemplateError);
  });

  it("rejects more than 10 cards", () => {
    const card: CarouselCard = {
      header: { type: "image", mediaId: "img" },
    };
    const cards = Array.from({ length: 11 }, () => card);
    expect(() => buildCarouselTemplate({ to: "+1", name: "x", language: "en_US", cards })).toThrow(
      TemplateError
    );
  });

  it("computes card_index from iteration order regardless of input", () => {
    const built = buildCarouselTemplate({
      to: "+1",
      name: "x",
      language: "en_US",
      cards: [
        { header: { type: "image", mediaId: "a" } },
        { header: { type: "image", mediaId: "b" } },
        { header: { type: "image", mediaId: "c" } },
      ],
    });
    const carouselComp = built.template.components!.find((c) => c.type === "carousel");
    expect(carouselComp).toBeDefined();
    const indexes = carouselComp!.cards!.map((c) => c.card_index);
    expect(indexes).toEqual([0, 1, 2]);
  });

  it("supports video headers", () => {
    const built = buildCarouselTemplate({
      to: "+1",
      name: "x",
      language: "en_US",
      cards: [{ header: { type: "video", mediaId: "vid" } }],
    });
    const card = built.template.components!.find((c) => c.type === "carousel")!.cards![0]!;
    const headerComp = card.components.find((c) => c.type === "header")!;
    expect(headerComp.parameters![0]).toEqual({ type: "video", video: { id: "vid" } });
  });

  it("supports public link headers", () => {
    const built = buildCarouselTemplate({
      to: "+1",
      name: "x",
      language: "en_US",
      cards: [{ header: { type: "image", link: "https://example.com/a.jpg" } }],
    });
    const card = built.template.components!.find((c) => c.type === "carousel")!.cards![0]!;
    const headerComp = card.components.find((c) => c.type === "header")!;
    expect(headerComp.parameters![0]).toEqual({
      type: "image",
      image: { link: "https://example.com/a.jpg" },
    });
  });

  it("emits quick_reply buttons with the documented payload parameter shape", () => {
    const built = buildCarouselTemplate({
      to: "+1",
      name: "x",
      language: "en_US",
      cards: [
        {
          header: { type: "image", mediaId: "a" },
          buttons: [{ subType: "quick_reply", payload: "MORE_LIKE_THIS" }],
        },
      ],
    });
    const card = built.template.components!.find((c) => c.type === "carousel")!.cards![0]!;
    const btn = card.components.find((c) => c.type === "button")!;
    expect(btn).toMatchObject({
      type: "button",
      sub_type: "quick_reply",
      index: 0,
      parameters: [{ type: "payload", payload: "MORE_LIKE_THIS" }],
    });
  });

  it("emits per-card body parameters when supplied", () => {
    const built = buildCarouselTemplate({
      to: "+1",
      name: "x",
      language: "en_US",
      cards: [
        {
          header: { type: "image", mediaId: "a" },
          bodyParameters: ["LOCAL_VAR_1", "LOCAL_VAR_2"],
        },
      ],
    });
    const card = built.template.components!.find((c) => c.type === "carousel")!.cards![0]!;
    const bodyComp = card.components.find((c) => c.type === "body");
    expect(bodyComp).toMatchObject({
      type: "body",
      parameters: [
        { type: "text", text: "LOCAL_VAR_1" },
        { type: "text", text: "LOCAL_VAR_2" },
      ],
    });
  });

  it("rejects a header without a media source", () => {
    expect(() =>
      buildCarouselTemplate({
        to: "+1",
        name: "x",
        language: "en_US",
        cards: [{ header: { type: "image" } }],
      })
    ).toThrow();
  });

  it("rejects a header with both mediaId and link", () => {
    expect(() =>
      buildCarouselTemplate({
        to: "+1",
        name: "x",
        language: "en_US",
        cards: [
          {
            header: { type: "image", mediaId: "x", link: "https://y" },
          },
        ],
      })
    ).toThrow();
  });
});
