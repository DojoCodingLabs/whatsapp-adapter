import type { RequestOptions } from "../client/transport.js";
import type { WhatsAppClient } from "../client/whatsapp-client.js";
import { WhatsAppError } from "../types/errors.js";

import { UnsupportedMediaTypeError } from "./errors.js";
import {
  classifyMediaFamily,
  MEDIA_MAX_BYTES,
  MEDIA_SUPPORTED_MIME_TYPES,
  type MediaFamily,
  normaliseMimeType,
  type UploadMediaInput,
  type UploadMediaResponse,
} from "./types.js";

/**
 * Compute the byte length of an upload payload across the supported
 * `BlobPart` variants. `Blob` reports size synchronously; other
 * variants expose `byteLength` or `.length` directly.
 */
export function payloadByteLength(file: UploadMediaInput["file"]): number {
  if (typeof file === "string") {
    // TextEncoder gives the byte length under UTF-8 — the encoding
    // the SDK's signature module already uses for raw-body work.
    return new TextEncoder().encode(file).byteLength;
  }
  if (file instanceof Uint8Array) return file.byteLength;
  if (typeof Blob !== "undefined" && file instanceof Blob) return file.size;
  if (file instanceof ArrayBuffer) return file.byteLength;
  // Defensive: shouldn't be reachable given the typed input.
  throw new WhatsAppError("UNKNOWN", "uploadMedia: unsupported `file` type.");
}

/**
 * Enforce Meta's per-family upload-size ceiling. Throws
 * `CapabilityError`-coded `WhatsAppError("CAPABILITY")` when the
 * payload is over the ceiling for its family.
 *
 * `image/webp` is classified as a regular image (5 MB) since
 * stickers and images share the same MIME type; the stricter
 * sticker buckets require the caller to pass `family` explicitly.
 */
export function assertSizeAllowed(
  byteLength: number,
  mimeType: string,
  family: MediaFamily = classifyMediaFamily(mimeType)
): void {
  const max = MEDIA_MAX_BYTES[family];
  if (byteLength > max) {
    const formattedMax = formatBytes(max);
    const formattedSize = formatBytes(byteLength);
    throw new WhatsAppError(
      "CAPABILITY",
      `uploadMedia: ${mimeType} payload of ${formattedSize} exceeds Meta's ${family} ceiling of ${formattedMax}.`
    );
  }
}

/**
 * Shared pre-flight for `uploadMedia` on both the real and the mock
 * client: input-shape validation plus the size gate. Returns the
 * payload byte length so callers don't measure twice. Throws
 * `WhatsAppError("UNKNOWN")` on a malformed input and
 * `WhatsAppError("CAPABILITY")` on an oversize payload — the same
 * classes the message builders use, so consumers get one catch
 * pattern across the SDK.
 */
export function validateUploadInput(input: UploadMediaInput): number {
  if (typeof input.mimeType !== "string" || input.mimeType.length === 0) {
    throw new WhatsAppError("UNKNOWN", "uploadMedia: `mimeType` must be a non-empty string.");
  }
  if (input.file === undefined || input.file === null) {
    throw new WhatsAppError("UNKNOWN", "uploadMedia: `file` must be supplied.");
  }
  const family = resolveUploadFamily(input);
  const bytes = payloadByteLength(input.file);
  assertSizeAllowed(bytes, input.mimeType, family);
  return bytes;
}

const MEDIA_FAMILIES: ReadonlySet<string> = new Set(Object.keys(MEDIA_MAX_BYTES));

/**
 * Resolve and check the upload's media family. An explicit `family`
 * must be a known family and agree with the MIME type; `image/*`,
 * `audio/*` and `video/*` types (and stickers) must be on Meta's
 * documented list; documents are only checked with `strictMimeType`.
 * Throws `UnsupportedMediaTypeError` (`code: "CAPABILITY"`).
 */
function resolveUploadFamily(input: UploadMediaInput): MediaFamily {
  const mime = normaliseMimeType(input.mimeType);
  const derived = classifyMediaFamily(mime);
  let family: MediaFamily = derived;
  if (input.family !== undefined) {
    if (!MEDIA_FAMILIES.has(input.family)) {
      throw new WhatsAppError("UNKNOWN", "uploadMedia: `family` is not a known media family.");
    }
    family = input.family;
  }
  const allowed: ReadonlyArray<string> = MEDIA_SUPPORTED_MIME_TYPES[family];
  const enforce = family !== "document" || input.strictMimeType === true;
  if (enforce && !allowed.includes(mime)) {
    throw new UnsupportedMediaTypeError(mime, family);
  }
  return family;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/**
 * Upload binary media to `POST /{phone-number-id}/media`. Returns
 * Meta's issued media id, which can be passed back into any
 * `sendImage` / `sendDocument` / etc. as the `id` field.
 *
 * Wire shape (multipart/form-data):
 *   - `messaging_product=whatsapp`
 *   - `file=<binary>`
 *   - `type=<mimeType>`
 *
 * Size guards run BEFORE the network call:
 *   - `image/*` → 5 MB
 *   - `audio/*` → 16 MB
 *   - `video/*` → 16 MB
 *   - everything else → 100 MB
 *
 * `image/webp` is size-gated at the regular image ceiling unless
 * `family: "sticker_static"` (100 KB) or `"sticker_animated"`
 * (500 KB) is passed. Image / audio / video MIME types outside Meta's
 * documented list (e.g. `image/gif`, `audio/wav`) reject with
 * `UnsupportedMediaTypeError`; document types are checked only with
 * `strictMimeType: true`.
 */
export async function uploadMedia(
  client: WhatsAppClient,
  input: UploadMediaInput,
  options?: RequestOptions
): Promise<UploadMediaResponse> {
  validateUploadInput(input);

  const form = buildUploadForm(input);
  const path = `/${client.phoneNumberId}/media`;

  // Reuse the transport's retry + observability + error-mapping
  // pipeline by handing fetch the pre-built FormData via the
  // bodyOverride escape hatch (transport skips JSON serialisation
  // when that's set).
  return client.request<UploadMediaResponse>("POST", path, undefined, {
    ...(options ?? {}),
    bodyOverride: form,
  });
}

/**
 * Build the `messaging_product` / `file` / `type` form Meta's
 * upload endpoint expects. Exposed primarily so tests can assert
 * the wire shape independently of the network call.
 */
export function buildUploadForm(input: UploadMediaInput): FormData {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", input.mimeType);

  // FormData wants a Blob for the `file` part so the multipart
  // boundary records the right Content-Type and (optionally) the
  // filename. Build one from whichever shape the caller supplied.
  const blob = coerceToBlob(input.file, input.mimeType);
  form.append("file", blob, input.filename ?? "upload");
  return form;
}

function coerceToBlob(file: UploadMediaInput["file"], mimeType: string): Blob {
  if (typeof Blob === "undefined") {
    throw new WhatsAppError(
      "UNKNOWN",
      "uploadMedia: this runtime does not provide a global `Blob`. Upgrade to Node ≥ 20 or supply a Blob polyfill."
    );
  }
  if (file instanceof Blob) return file;
  if (file instanceof Uint8Array) return new Blob([file], { type: mimeType });
  if (file instanceof ArrayBuffer) return new Blob([new Uint8Array(file)], { type: mimeType });
  if (typeof file === "string") return new Blob([file], { type: mimeType });
  // Unreachable given the typed input, but keeps TS happy.
  throw new WhatsAppError("UNKNOWN", "uploadMedia: unsupported `file` type.");
}
