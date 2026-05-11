import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildVoice } from "../../../src/messages/builders.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../__fixtures__/messages/voice-note.json", import.meta.url)
);

async function loadFixture(): Promise<Record<string, unknown>> {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const { _source, _note, ...rest } = parsed as { _source?: unknown; _note?: unknown };
  void _source;
  void _note;
  return rest;
}

describe("buildVoice (audio with voice:true)", () => {
  it("produces Meta's documented wire payload byte-for-byte", async () => {
    const fixture = await loadFixture();
    const built = buildVoice({ to: "+16505551234", id: "1013859600285441" });
    expect(built).toEqual(fixture);
  });

  it("supports a public link instead of a pre-uploaded media id", () => {
    const built = buildVoice({ to: "+1", link: "https://example.com/voice.ogg" });
    expect(built.audio).toEqual({ link: "https://example.com/voice.ogg", voice: true });
  });

  it("always sets voice:true", () => {
    const built = buildVoice({ to: "+1", id: "mid" });
    expect(built.audio.voice).toBe(true);
  });

  it("rejects when neither id nor link is supplied", () => {
    expect(() => buildVoice({ to: "+1" })).toThrow();
  });

  it("rejects when both id and link are supplied", () => {
    expect(() => buildVoice({ to: "+1", id: "x", link: "https://y" })).toThrow();
  });
});
