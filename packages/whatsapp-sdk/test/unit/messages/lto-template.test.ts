import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildTemplate } from "../../../src/messages/builders.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../__fixtures__/messages/lto-template.json", import.meta.url)
);

async function loadFixture(): Promise<Record<string, unknown>> {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const { _source, _note, ...rest } = parsed as { _source?: unknown; _note?: unknown };
  void _source;
  void _note;
  return rest;
}

describe("buildTemplate with limited_time_offer + coupon_code", () => {
  it("produces Meta's documented LTO wire payload byte-for-byte", async () => {
    const fixture = await loadFixture();
    const built = buildTemplate({
      to: "16505555555",
      name: "limited_time_offer_caribbean_pkg_2023",
      language: "en_US",
      components: [
        {
          type: "header",
          parameters: [{ type: "image", image: { id: "1602186516975000" } }],
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: "Pablo" },
            { type: "text", text: "CARIBE25" },
          ],
        },
        {
          type: "limited_time_offer",
          parameters: [
            {
              type: "limited_time_offer",
              limited_time_offer: { expiration_time_ms: 1209600000 },
            },
          ],
        },
        {
          type: "button",
          sub_type: "copy_code",
          index: 0,
          parameters: [{ type: "coupon_code", coupon_code: "CARIBE25" }],
        },
        {
          type: "button",
          sub_type: "url",
          index: 1,
          parameters: [{ type: "text", text: "n3mtql" }],
        },
      ],
    });
    expect(built).toEqual(fixture);
  });

  it("accepts limited_time_offer as a top-level component type", () => {
    const built = buildTemplate({
      to: "+1",
      name: "x",
      language: "en_US",
      components: [
        {
          type: "limited_time_offer",
          parameters: [
            { type: "limited_time_offer", limited_time_offer: { expiration_time_ms: 1000 } },
          ],
        },
      ],
    });
    expect(built.template.components![0]).toMatchObject({ type: "limited_time_offer" });
  });

  it("accepts a copy_code sub_type button with coupon_code parameter", () => {
    const built = buildTemplate({
      to: "+1",
      name: "x",
      language: "en_US",
      components: [
        {
          type: "button",
          sub_type: "copy_code",
          index: 0,
          parameters: [{ type: "coupon_code", coupon_code: "PROMO10" }],
        },
      ],
    });
    expect(built.template.components![0]).toMatchObject({
      type: "button",
      sub_type: "copy_code",
      parameters: [{ type: "coupon_code", coupon_code: "PROMO10" }],
    });
  });
});
