import { fetchExternal, type RequestOptions } from "../client/transport.js";
import type { WhatsAppClient } from "../client/whatsapp-client.js";
import { WhatsAppError } from "../types/errors.js";

import type { DownloadedMedia, MediaFetchOptions, MediaInfo } from "./types.js";

/**
 * Meta's wire shape for `GET /{media-id}`. Note: snake_case on the
 * wire, camelCase on our public {@link MediaInfo}.
 */
interface MetaMediaInfoResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number | string;
  id: string;
  messaging_product?: string;
}

/**
 * Two-step media download:
 *   1. `GET /{media-id}` → metadata + pre-signed `scontent` URL
 *      (URL expires 5 minutes after issue).
 *   2. `fetchBytes()` GETs the URL with `Authorization: Bearer`.
 *
 * Returns metadata eagerly (the lookup round-trip is cheap and
 * the sha256 / size / mime are useful for caching, hashing,
 * audit logs). The binary fetch is lazy via `fetchBytes()` —
 * consumers that only need the metadata don't pay the bandwidth.
 *
 * The `options` passed here (retry policy, `fetchImpl`, hooks) are
 * inherited by `fetchBytes()` unless it is given its own; the
 * `signal` and `requestId` are NOT inherited so each step is
 * independently cancellable / correlatable.
 *
 * @example
 * ```ts
 * const info = await client.downloadMedia(event.media!.id);
 * await uploadToS3({ key: info.sha256, mimeType: info.mimeType });
 * const bytes = await info.fetchBytes();
 * ```
 */
export async function downloadMedia(
  client: WhatsAppClient,
  mediaId: string,
  options?: RequestOptions
): Promise<DownloadedMedia> {
  if (typeof mediaId !== "string" || mediaId.length === 0) {
    throw new WhatsAppError("UNKNOWN", "downloadMedia: `mediaId` must be a non-empty string.");
  }
  const wire = await client.request<MetaMediaInfoResponse>(
    "GET",
    `/${mediaId}`,
    undefined,
    options
  );
  const info = normaliseInfo(wire, mediaId);

  const inherited: MediaFetchOptions = {
    ...(options?.retryPolicy !== undefined ? { retryPolicy: options.retryPolicy } : {}),
    ...(options?.retryHooks !== undefined ? { retryHooks: options.retryHooks } : {}),
    ...(options?.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  };

  return {
    ...info,
    fetchBytes: (opts?: MediaFetchOptions): Promise<Uint8Array> =>
      fetchExternal(client, info.url, { ...inherited, ...(opts ?? {}), mediaId }),
  };
}

/**
 * Fetch the bytes of a previously-resolved media URL, re-injecting
 * the WABA bearer token. Stand-alone helper so consumers that
 * already have a `MediaInfo` (e.g. from a prior `downloadMedia`)
 * can fetch bytes without a fresh metadata lookup.
 *
 * Goes through the SDK transport: one `whatsapp.media.fetch` OTel
 * span, retry on 429 / 5xx, `fetchImpl` override, caller `signal`.
 * Rejects with `MediaExpiredError` on 401 / 403 / 404 / 410 — the
 * URL has outlived Meta's 5-minute TTL; call `downloadMedia()` again
 * for a fresh one instead of retrying.
 *
 * The third argument accepts a bare `AbortSignal` for backwards
 * compatibility with `0.9.x`; prefer the options object.
 */
export function fetchMediaUrl(
  client: WhatsAppClient,
  url: string,
  options?: MediaFetchOptions | AbortSignal
): Promise<Uint8Array> {
  if (typeof url !== "string" || url.length === 0) {
    return Promise.reject(
      new WhatsAppError("UNKNOWN", "fetchMediaUrl: `url` must be a non-empty string.")
    );
  }
  const resolved: MediaFetchOptions =
    options !== undefined && isAbortSignal(options) ? { signal: options } : (options ?? {});
  return fetchExternal(client, url, resolved);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

function normaliseInfo(wire: MetaMediaInfoResponse, mediaId: string): MediaInfo {
  if (typeof wire.url !== "string" || wire.url.length === 0) {
    throw new WhatsAppError(
      "UNKNOWN",
      `downloadMedia: Meta returned no \`url\` field for media ${mediaId}.`
    );
  }
  const fileSize =
    typeof wire.file_size === "number"
      ? wire.file_size
      : Number.parseInt(String(wire.file_size), 10);
  return {
    id: typeof wire.id === "string" && wire.id.length > 0 ? wire.id : mediaId,
    mimeType: wire.mime_type,
    sha256: wire.sha256,
    fileSize: Number.isFinite(fileSize) ? fileSize : 0,
    url: wire.url,
  };
}
