// Parity with doji-agent test/whatsapp/graph-inbound.test.ts (splitText)
// and reply-optout.test.ts (toWhatsAppText).
import { describe, expect, it } from "vitest";

import { clipText, splitText, toWhatsAppText } from "../../../src/reply/index.js";
import { MESSAGE_LENGTH_LIMITS } from "../../../src/types/constants.js";

describe("splitText (4,096 limit, never truncated)", () => {
  it("keeps a short text whole", () => {
    expect(splitText("hola")).toEqual(["hola"]);
  });

  it("returns [] for empty or whitespace-only input", () => {
    expect(splitText("")).toEqual([]);
    expect(splitText("  \n ")).toEqual([]);
  });

  it("splits on paragraph breaks and loses no character", () => {
    const para = "x".repeat(3000);
    const text = `${para}\n\n${para}\n\n${para}`;
    const parts = splitText(text);
    expect(parts.length).toBe(3);
    for (const p of parts)
      expect(Array.from(p).length).toBeLessThanOrEqual(MESSAGE_LENGTH_LIMITS.textBody);
    expect(parts.join("\n\n")).toBe(text);
  });

  it("cuts an unbroken run at exactly 4,096 code points", () => {
    const text = "a".repeat(10_000);
    const parts = splitText(text);
    expect(parts.map((p) => p.length)).toEqual([4096, 4096, 1808]);
    expect(parts.join("")).toBe(text);
  });

  it("counts code points, so emoji are never split in half", () => {
    const text = "😀".repeat(5000);
    const parts = splitText(text);
    expect(parts.every((p) => Array.from(p).length <= 4096 && !p.includes("�"))).toBe(true);
    expect(parts.join("")).toBe(text);
  });

  it("prefers a space near the end of the window over a mid-word cut", () => {
    const words = Array.from({ length: 1500 }, (_, i) => `w${i}`).join(" ");
    const parts = splitText(words);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => !p.startsWith(" ") && !p.endsWith(" "))).toBe(true);
    expect(parts.join(" ")).toBe(words);
  });

  it("prefers paragraph → line → sentence → space, only in the last half of the window", () => {
    // max 20, floor 10
    expect(splitText("aaaaaaaaaaaa\n\nbb\ncc dd ee", 20)).toEqual(["aaaaaaaaaaaa", "bb\ncc dd ee"]);
    expect(splitText("aaaaaaaaaaaa\nbb. cc dd ee ff", 20)).toEqual([
      "aaaaaaaaaaaa",
      "bb. cc dd ee ff",
    ]);
    expect(splitText("aaaaaaaaaaaa. bb cc dd ee ff", 20)).toEqual([
      "aaaaaaaaaaaa.",
      "bb cc dd ee ff",
    ]);
    // A break in the first half is ignored: the last space in the window wins.
    expect(splitText("aa\n\nbbbbbbbbbbbb cc ddddd", 20)).toEqual([
      "aa\n\nbbbbbbbbbbbb cc",
      "ddddd",
    ]);
  });

  it("honours a custom max and rejects a non-positive one", () => {
    expect(splitText("abcdef", 2)).toEqual(["ab", "cd", "ef"]);
    expect(() => splitText("x", 0)).toThrow(RangeError);
  });
});

describe("clipText", () => {
  it("keeps short text, trims, and clips with an ellipsis by code point", () => {
    expect(clipText("  Sí  ", 20)).toBe("Sí");
    expect(clipText("Una opción muy larga que no entra", 20)).toBe("Una opción muy larg…");
    expect(Array.from(clipText("😀".repeat(30), 20)).length).toBe(20);
    expect(clipText("😀".repeat(30), 20)).not.toContain("�");
    expect(clipText(undefined, 5)).toBe("");
    expect(clipText("abc", 1)).toBe("a");
  });
});

describe("toWhatsAppText", () => {
  it("trims trailing whitespace inside converted headings", () => {
    expect(toWhatsAppText("## Precios   ")).toBe("*Precios*");
    expect(toWhatsAppText("#    \n")).toBe("#    \n");
  });

  it("runs in linear time on adversarial heading whitespace (ReDoS)", () => {
    const evil = "#" + " ".repeat(100_000) + "\u0000";
    const t0 = performance.now();
    toWhatsAppText(evil);
    toWhatsAppText(("# " + " \t".repeat(20_000) + "\n").repeat(5));
    expect(performance.now() - t0).toBeLessThan(250);
  });

  it("maps markdown to WhatsApp formatting", () => {
    expect(toWhatsAppText("## Plan\n**Paso 1**: [Abrí Dojo](https://www.trydojo.io)")).toBe(
      "*Plan*\n*Paso 1*: Abrí Dojo: https://www.trydojo.io"
    );
  });

  it("maps italics, strikethrough, and a link whose text is its URL", () => {
    expect(toWhatsAppText("__i__ ~~s~~ [https://x.test](https://x.test)")).toBe(
      "_i_ ~s~ https://x.test"
    );
  });
});
