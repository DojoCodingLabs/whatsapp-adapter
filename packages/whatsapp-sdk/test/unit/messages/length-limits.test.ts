import { describe, expect, it } from "vitest";

import {
  buildDocument,
  buildImage,
  buildInteractiveButton,
  buildInteractiveCtaUrl,
  buildInteractiveList,
  buildText,
  buildVideo,
} from "../../../src/messages/builders.js";
import { MESSAGE_LENGTH_LIMITS as L } from "../../../src/types/constants.js";
import { WhatsAppError } from "../../../src/types/errors.js";

const TO = "521234567890";
const s = (n: number): string => "x".repeat(n);

function expectLengthError(fn: () => unknown, field: string, max: number): void {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(WhatsAppError);
  expect((err as WhatsAppError).code).toBe("UNKNOWN");
  expect((err as WhatsAppError).message).toContain(field);
  expect((err as WhatsAppError).message).toContain(`${max}-character maximum`);
}

describe("MESSAGE_LENGTH_LIMITS matches Meta's documented ceilings", () => {
  it("pins the values", () => {
    expect(L).toEqual({
      textBody: 4096,
      mediaCaption: 1024,
      interactiveBody: 1024,
      interactiveFooter: 60,
      interactiveHeaderText: 60,
      replyButtonTitle: 20,
      replyButtonId: 256,
      listButton: 20,
      listSectionTitle: 24,
      listRowTitle: 24,
      listRowDescription: 72,
      listRowId: 200,
      ctaUrlDisplayText: 20,
    });
  });
});

describe("buildText length pre-flight", () => {
  it("accepts exactly 4096 characters", () => {
    expect(buildText({ to: TO, body: s(L.textBody) }).text.body).toHaveLength(L.textBody);
  });
  it("rejects 4097 characters", () => {
    expectLengthError(() => buildText({ to: TO, body: s(L.textBody + 1) }), "body", L.textBody);
  });
  it("counts code points, not UTF-16 units (emoji-heavy bodies are not over-rejected)", () => {
    // 4096 astral-plane emoji = 8192 UTF-16 code units but 4096 characters.
    const body = "😀".repeat(L.textBody);
    expect(body.length).toBe(L.textBody * 2);
    expect(() => buildText({ to: TO, body })).not.toThrow();
  });
});

describe("media caption pre-flight", () => {
  it.each([
    ["buildImage", buildImage],
    ["buildVideo", buildVideo],
    ["buildDocument", buildDocument],
  ] as const)("%s rejects a caption over 1024 characters", (name, fn) => {
    expect(() => fn({ to: TO, link: "https://e.com/a", caption: s(L.mediaCaption) })).not.toThrow();
    expectLengthError(
      () => fn({ to: TO, link: "https://e.com/a", caption: s(L.mediaCaption + 1) }),
      `${name}.caption`,
      L.mediaCaption
    );
  });
});

describe("buildInteractiveButton length pre-flight", () => {
  const base = { to: TO, body: "Pick", buttons: [{ id: "a", title: "A" }] };
  it("body > 1024", () => {
    expectLengthError(
      () => buildInteractiveButton({ ...base, body: s(L.interactiveBody + 1) }),
      "body",
      L.interactiveBody
    );
  });
  it("footer > 60", () => {
    expectLengthError(
      () => buildInteractiveButton({ ...base, footer: s(L.interactiveFooter + 1) }),
      "footer",
      L.interactiveFooter
    );
  });
  it("text header > 60 (media headers are not length-checked)", () => {
    expectLengthError(
      () =>
        buildInteractiveButton({
          ...base,
          header: { type: "text", text: s(L.interactiveHeaderText + 1) },
        }),
      "header.text",
      L.interactiveHeaderText
    );
    expect(() =>
      buildInteractiveButton({
        ...base,
        header: { type: "image", image: { link: "https://e.com/i" } },
      })
    ).not.toThrow();
  });
  it("button title > 20 names the offending index", () => {
    expectLengthError(
      () =>
        buildInteractiveButton({
          ...base,
          buttons: [
            { id: "a", title: "ok" },
            { id: "b", title: s(L.replyButtonTitle + 1) },
          ],
        }),
      "buttons[1].title",
      L.replyButtonTitle
    );
  });
  it("button id > 256", () => {
    expectLengthError(
      () =>
        buildInteractiveButton({ ...base, buttons: [{ id: s(L.replyButtonId + 1), title: "A" }] }),
      "buttons[0].id",
      L.replyButtonId
    );
  });
  it("accepts every field at exactly its limit", () => {
    expect(() =>
      buildInteractiveButton({
        to: TO,
        body: s(L.interactiveBody),
        footer: s(L.interactiveFooter),
        header: { type: "text", text: s(L.interactiveHeaderText) },
        buttons: [{ id: s(L.replyButtonId), title: s(L.replyButtonTitle) }],
      })
    ).not.toThrow();
  });
});

describe("buildInteractiveList length pre-flight", () => {
  const base = {
    to: TO,
    body: "Pick",
    button: "Menu",
    sections: [{ title: "S", rows: [{ id: "r1", title: "R1" }] }],
  };
  it("button label > 20", () => {
    expectLengthError(
      () => buildInteractiveList({ ...base, button: s(L.listButton + 1) }),
      "button",
      L.listButton
    );
  });
  it("section title > 24 names the section", () => {
    expectLengthError(
      () =>
        buildInteractiveList({
          ...base,
          sections: [
            { title: "ok", rows: [{ id: "a", title: "A" }] },
            { title: s(L.listSectionTitle + 1), rows: [{ id: "b", title: "B" }] },
          ],
        }),
      "sections[1].title",
      L.listSectionTitle
    );
  });
  it("row title > 24, description > 72, id > 200 name the row", () => {
    expectLengthError(
      () =>
        buildInteractiveList({
          ...base,
          sections: [{ title: "S", rows: [{ id: "a", title: s(L.listRowTitle + 1) }] }],
        }),
      "sections[0].rows[0].title",
      L.listRowTitle
    );
    expectLengthError(
      () =>
        buildInteractiveList({
          ...base,
          sections: [
            {
              title: "S",
              rows: [{ id: "a", title: "A", description: s(L.listRowDescription + 1) }],
            },
          ],
        }),
      "rows[0].description",
      L.listRowDescription
    );
    expectLengthError(
      () =>
        buildInteractiveList({
          ...base,
          sections: [{ title: "S", rows: [{ id: s(L.listRowId + 1), title: "A" }] }],
        }),
      "rows[0].id",
      L.listRowId
    );
  });
  it("body / footer / text header share the interactive limits", () => {
    expectLengthError(
      () => buildInteractiveList({ ...base, body: s(L.interactiveBody + 1) }),
      "body",
      L.interactiveBody
    );
    expectLengthError(
      () => buildInteractiveList({ ...base, footer: s(L.interactiveFooter + 1) }),
      "footer",
      L.interactiveFooter
    );
    expectLengthError(
      () =>
        buildInteractiveList({
          ...base,
          header: { type: "text", text: s(L.interactiveHeaderText + 1) },
        }),
      "header.text",
      L.interactiveHeaderText
    );
  });
});

describe("buildInteractiveCtaUrl length pre-flight", () => {
  const base = { to: TO, body: "Go", cta: { displayText: "Open", url: "https://e.com" } };
  it("displayText > 20", () => {
    expectLengthError(
      () =>
        buildInteractiveCtaUrl({
          ...base,
          cta: { displayText: s(L.ctaUrlDisplayText + 1), url: "https://e.com" },
        }),
      "cta.displayText",
      L.ctaUrlDisplayText
    );
  });
  it("body / footer / header", () => {
    expectLengthError(
      () => buildInteractiveCtaUrl({ ...base, body: s(L.interactiveBody + 1) }),
      "body",
      L.interactiveBody
    );
    expectLengthError(
      () => buildInteractiveCtaUrl({ ...base, footer: s(L.interactiveFooter + 1) }),
      "footer",
      L.interactiveFooter
    );
    expectLengthError(
      () =>
        buildInteractiveCtaUrl({
          ...base,
          header: { type: "text", text: s(L.interactiveHeaderText + 1) },
        }),
      "header.text",
      L.interactiveHeaderText
    );
  });
});
