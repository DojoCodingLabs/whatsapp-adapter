import type { RequestOptions } from "../client/transport.js";
import type { WhatsAppClient } from "../client/whatsapp-client.js";
import { WhatsAppError } from "../types/errors.js";

import {
  classifyMediaFamily,
  MEDIA_MAX_BYTES,
  type MediaFamily,
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
  const bytes = payloadByteLength(input.file);
  assertSizeAllowed(bytes, input.mimeType, classifyMediaFamily(input.mimeType));
  return bytes;
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
 * `image/webp` stickers are size-gated at the regular image
 * ceiling here — the sticker-specific 100 KB / 500 KB ceilings
 * require explicit consumer opt-in (Meta validates them
 * post-upload regardless).
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
