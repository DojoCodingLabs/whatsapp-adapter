import { describe, expect, it } from "vitest";

import { MediaTooLargeError, UnsupportedMediaTypeError } from "../../../src/media/errors.js";
import { MEDIA_MAX_BYTES } from "../../../src/media/types.js";
import { validateUploadInput } from "../../../src/media/upload.js";
import { MockWhatsAppClient } from "../../../src/mock/client.js";
import { CapabilityError, WhatsAppError } from "../../../src/types/errors.js";

const bytes = (n: number): Uint8Array => new Uint8Array(n);

describe("upload MIME allowlist (Meta supported media types)", () => {
  it.each(["image/gif", "image/bmp", "audio/wav", "audio/webm", "video/quicktime", "video/webm"])(
    "rejects %s with UnsupportedMediaTypeError (CAPABILITY)",
    (mimeType) => {
      let err: unknown;
      try {
        validateUploadInput({ file: bytes(10), mimeType });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(UnsupportedMediaTypeError);
      expect(err).toBeInstanceOf(CapabilityError);
      expect((err as UnsupportedMediaTypeError).code).toBe("CAPABILITY");
    }
  );

  it.each([
    "image/jpeg",
    "image/png",
    "image/webp",
    "audio/aac",
    "audio/amr",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg; codecs=opus",
    "video/3gpp",
    "video/mp4",
    "application/pdf",
    "text/plain",
  ])("accepts %s", (mimeType) => {
    expect(validateUploadInput({ file: bytes(10), mimeType })).toBe(10);
  });

  it("documents with an undocumented MIME pass unless strictMimeType is set", () => {
    expect(validateUploadInput({ file: bytes(1), mimeType: "application/zip" })).toBe(1);
    expect(() =>
      validateUploadInput({ file: bytes(1), mimeType: "application/zip", strictMimeType: true })
    ).toThrow(UnsupportedMediaTypeError);
  });
});

describe("upload family hint (stickers)", () => {
  it("sticker_static caps image/webp at 100 KB; sticker_animated at 500 KB", () => {
    const over = MEDIA_MAX_BYTES.sticker_static + 1;
    // Without the hint the 5 MB image ceiling applies.
    expect(validateUploadInput({ file: bytes(over), mimeType: "image/webp" })).toBe(over);
    expect(() =>
      validateUploadInput({ file: bytes(over), mimeType: "image/webp", family: "sticker_static" })
    ).toThrow(/sticker_static ceiling/);
    expect(
      validateUploadInput({ file: bytes(over), mimeType: "image/webp", family: "sticker_animated" })
    ).toBe(over);
    expect(() =>
      validateUploadInput({
        file: bytes(MEDIA_MAX_BYTES.sticker_animated + 1),
        mimeType: "image/webp",
        family: "sticker_animated",
      })
    ).toThrow(/sticker_animated ceiling/);
  });

  it("a sticker must be image/webp", () => {
    expect(() =>
      validateUploadInput({ file: bytes(1), mimeType: "image/png", family: "sticker_static" })
    ).toThrow(UnsupportedMediaTypeError);
  });

  it("an unknown family is an input error", () => {
    expect(() =>
      validateUploadInput({ file: bytes(1), mimeType: "image/png", family: "gif" as never })
    ).toThrow(WhatsAppError);
  });

  it("the mock client applies the same MIME / family gate", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    await expect(m.uploadMedia({ file: bytes(1), mimeType: "image/gif" })).rejects.toBeInstanceOf(
      UnsupportedMediaTypeError
    );
    await expect(
      m.uploadMedia({
        file: bytes(MEDIA_MAX_BYTES.sticker_static + 1),
        mimeType: "image/webp",
        family: "sticker_static",
      })
    ).rejects.toThrow(/sticker_static/);
  });
});

describe("mock downloadMedia honours maxBytes like the real client", () => {
  it("fetchBytes rejects with MediaTooLargeError when fileSize > maxBytes", async () => {
    const m = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    const { id } = await m.uploadMedia({ file: bytes(2048), mimeType: "image/jpeg" });
    const info = await m.downloadMedia(id, { maxBytes: 1024 });
    await expect(info.fetchBytes()).rejects.toBeInstanceOf(MediaTooLargeError);
    expect((await info.fetchBytes({ maxBytes: 4096 })).byteLength).toBe(2048);
  });
});
