import { describe, expect, it } from "vitest";

import { classifyMediaFamily, MEDIA_MAX_BYTES } from "../../../src/media/types.js";
import { buildUploadForm } from "../../../src/media/upload.js";
import { MockWhatsAppClient } from "../../../src/mock/client.js";
import { WhatsAppError } from "../../../src/types/errors.js";

describe("buildUploadForm", () => {
  it("emits the canonical messaging_product / type / file fields", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const form = buildUploadForm({
      file: bytes,
      mimeType: "image/jpeg",
      filename: "kitten.jpg",
    });
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("image/jpeg");
    const filePart = form.get("file");
    expect(filePart).toBeInstanceOf(Blob);
    // FormData implementations preserve the supplied filename
    // either on a File subclass or via the Content-Disposition
    // header in the wire body. Vitest's jsdom mode lifts it to
    // `(filePart as File).name`.
    if ("name" in (filePart as object)) {
      expect((filePart as File).name).toBe("kitten.jpg");
    }
  });

  it("defaults the filename to `upload` when omitted", () => {
    const form = buildUploadForm({ file: new Uint8Array([1]), mimeType: "audio/mp3" });
    const filePart = form.get("file");
    if ("name" in (filePart as object)) {
      expect((filePart as File).name).toBe("upload");
    }
  });
});

describe("classifyMediaFamily", () => {
  it.each([
    ["image/png", "image"],
    ["image/jpeg", "image"],
    ["audio/ogg", "audio"],
    ["video/mp4", "video"],
    ["application/pdf", "document"],
    ["text/plain", "document"],
  ] as const)("classifies %s → %s", (mime, family) => {
    expect(classifyMediaFamily(mime)).toBe(family);
  });
});

describe("MEDIA_MAX_BYTES", () => {
  it("matches Meta's documented per-family ceilings", () => {
    expect(MEDIA_MAX_BYTES.image).toBe(5 * 1024 * 1024);
    expect(MEDIA_MAX_BYTES.audio).toBe(16 * 1024 * 1024);
    expect(MEDIA_MAX_BYTES.video).toBe(16 * 1024 * 1024);
    expect(MEDIA_MAX_BYTES.document).toBe(100 * 1024 * 1024);
    expect(MEDIA_MAX_BYTES.sticker_static).toBe(100 * 1024);
    expect(MEDIA_MAX_BYTES.sticker_animated).toBe(500 * 1024);
  });
});

describe("MockWhatsAppClient media upload/download round-trip", () => {
  it("issues an id, then resolves metadata for that id", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    const bytes = new Uint8Array(1024);
    const { id } = await m.uploadMedia({ file: bytes, mimeType: "image/jpeg" });
    expect(id).toMatch(/^media\.mock-\d+$/);

    const info = await m.downloadMedia(id);
    expect(info.mimeType).toBe("image/jpeg");
    expect(info.fileSize).toBe(1024);
    expect(info.sha256).toBe(`mock-sha256-${id}`);

    const fetched = await info.fetchBytes();
    expect(fetched.byteLength).toBe(1024);
  });

  it("downloadMedia rejects on unknown id with a WhatsAppError", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    await expect(m.downloadMedia("media.never-uploaded")).rejects.toBeInstanceOf(WhatsAppError);
  });

  it("reset() clears uploaded media", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    const { id } = await m.uploadMedia({
      file: new Uint8Array(8),
      mimeType: "image/png",
    });
    m.reset();
    await expect(m.downloadMedia(id)).rejects.toBeInstanceOf(WhatsAppError);
  });
});
