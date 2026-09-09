import type { ExternalFetchOptions } from "../client/transport.js";

/**
 * Per-family upload size ceilings documented by Meta for WhatsApp
 * Cloud API media. The SDK enforces these BEFORE the multipart
 * POST so consumers don't waste a round-trip on payloads Meta will
 * reject. Source:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */
export const MEDIA_MAX_BYTES = {
  /** Static (.webp) stickers — Meta caps at 100 KB. */
  sticker_static: 100 * 1024,
  /** Animated (.webp) stickers — Meta caps at 500 KB. */
  sticker_animated: 500 * 1024,
  /** Image (jpeg/png) — 5 MB. */
  image: 5 * 1024 * 1024,
  /** Audio (aac/m4a/amr/mp3/ogg) — 16 MB. */
  audio: 16 * 1024 * 1024,
  /** Video (3gp/mp4) — 16 MB. */
  video: 16 * 1024 * 1024,
  /** Document — 100 MB (the largest allowed). */
  document: 100 * 1024 * 1024,
} as const;

/**
 * Family classification used by {@link MEDIA_MAX_BYTES}. Derived from
 * the supplied `mimeType` by {@link classifyMediaFamily}.
 */
export type MediaFamily =
  | "sticker_static"
  | "sticker_animated"
  | "image"
  | "audio"
  | "video"
  | "document";

/** Input for {@link uploadMedia} / `WhatsAppClient.uploadMedia`. */
export interface UploadMediaInput {
  /**
   * The raw bytes to upload. Accepts anything that satisfies
   * `BlobPart` — `Uint8Array`, `ArrayBuffer`, `Blob`, or `string`.
   * In Node ≥ 20, `Buffer` is a `Uint8Array` and works directly.
   */
  file: Uint8Array | ArrayBuffer | Blob | string;
  /**
   * Media MIME type (`image/jpeg`, `application/pdf`, etc.). Meta
   * uses this to classify the upload; mismatched MIME types are
   * rejected at send-time, so the SDK echoes it into the
   * multipart `type` field.
   */
  mimeType: string;
  /**
   * Optional filename for the multipart part. Helps `document`
   * sends preserve the original filename in the recipient's
   * WhatsApp app. Defaults to `upload`.
   */
  filename?: string;
}

/** Result of {@link uploadMedia}. */
export interface UploadMediaResponse {
  /**
   * Meta-issued media id. Reusable in any `sendImage` / `sendAudio`
   * / `sendDocument` / `sendVideo` / `sendSticker` / `sendVoice`
   * call as the `id` field. Bound to the uploading WABA-phone
   * pair — cannot be used cross-WABA.
   */
  id: string;
}

/**
 * Metadata returned by Meta's `GET /{media-id}` endpoint. Mirrors
 * Meta's wire shape but with camelCase field names.
 */
export interface MediaInfo {
  /** Meta media id (echoed back). */
  id: string;
  /** Media MIME type. */
  mimeType: string;
  /** SHA-256 hex digest of the media bytes. Useful for caching. */
  sha256: string;
  /** Total bytes. */
  fileSize: number;
  /**
   * Pre-signed `scontent.*.fbcdn.net` URL. **Expires 5 minutes
   * after issue** and is bearer-authenticated — do NOT hand it
   * directly to the LLM or to an unauthenticated client. Use
   * {@link DownloadedMedia.fetchBytes} (which re-injects the
   * bearer) or proxy through your own pre-signed storage layer.
   */
  url: string;
}

/**
 * Result of {@link downloadMedia}. The bytes are NOT eagerly
 * fetched — the metadata round-trip is cheap and useful on its
 * own (sha256, size, mime), and the binary fetch is only worth
 * the bandwidth when consumers need the body.
 */
export interface DownloadedMedia extends MediaInfo {
  /**
   * Fetch the media bytes from the pre-signed `url`, re-injecting
   * the bearer token. Returns a `Uint8Array`.
   *
   * Runs through the SDK transport (OTel span `whatsapp.media.fetch`,
   * retry on 429 / 5xx, `fetchImpl` override, `signal`). Rejects with
   * `MediaExpiredError` when the URL has outlived Meta's 5-minute
   * TTL — call `downloadMedia()` again rather than retrying.
   */
  fetchBytes(options?: MediaFetchOptions): Promise<Uint8Array>;
}

/**
 * Per-call options for {@link DownloadedMedia.fetchBytes} and
 * `fetchMediaUrl` — the transport's `RequestOptions` minus the
 * Graph-only fields (`graphApiVersion`, `bodyOverride`).
 */
export type MediaFetchOptions = ExternalFetchOptions;

/**
 * Classify a MIME type into a {@link MediaFamily} for size-limit
 * gating. `image/webp` is treated as `sticker_static` only when
 * the caller has already declared it as a sticker via an
 * explicit `family` override — the heuristic alone can't
 * disambiguate stickers from regular images.
 */
export function classifyMediaFamily(mimeType: string): MediaFamily {
  const t = mimeType.toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  return "document";
}
