import type { RequestOptions } from "../client/transport.js";
import type { WhatsAppClient } from "../client/whatsapp-client.js";
import { WhatsAppError } from "../types/errors.js";

import type { DownloadedMedia, MediaInfo } from "./types.js";

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
    throw new TypeError("downloadMedia: `mediaId` must be a non-empty string.");
  }
  const wire = await client.request<MetaMediaInfoResponse>(
    "GET",
    `/${mediaId}`,
    undefined,
    options
  );
  const info = normaliseInfo(wire);

  return {
    ...info,
    fetchBytes: async (opts?: { signal?: AbortSignal }): Promise<Uint8Array> => {
      return fetchMediaUrl(client, info.url, opts?.signal);
    },
  };
}

/**
 * Fetch the bytes of a previously-resolved media URL, re-injecting
 * the WABA bearer token. Stand-alone helper so consumers that
 * already have a `MediaInfo` (e.g. cached from a prior download)
 * can fetch bytes without a fresh metadata lookup.
 *
 * Throws if the URL has expired (Meta's 5-minute TTL) — the
 * response will be a 4xx that surfaces as a `WhatsAppError`.
 */
export async function fetchMediaUrl(
  client: WhatsAppClient,
  url: string,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const bearer = await client._resolveBearerToken();
  const init: RequestInit = {
    method: "GET",
    headers: { Authorization: `Bearer ${bearer}` },
  };
  if (signal !== undefined) init.signal = signal;
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new WhatsAppError(
      "UNKNOWN",
      `fetchMediaUrl: media URL returned ${response.status} (likely expired; Meta TTLs the URL at 5 minutes).`
    );
  }
  const buf = await response.arrayBuffer();
  return new Uint8Array(buf);
}

function normaliseInfo(wire: MetaMediaInfoResponse): MediaInfo {
  if (typeof wire.url !== "string" || wire.url.length === 0) {
    throw new WhatsAppError("UNKNOWN", "downloadMedia: Meta returned no `url` field.");
  }
  const fileSize =
    typeof wire.file_size === "number"
      ? wire.file_size
      : Number.parseInt(String(wire.file_size), 10);
  return {
    id: wire.id,
    mimeType: wire.mime_type,
    sha256: wire.sha256,
    fileSize: Number.isFinite(fileSize) ? fileSize : 0,
    url: wire.url,
  };
}
