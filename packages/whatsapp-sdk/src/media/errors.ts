import { CapabilityError, WhatsAppError } from "../types/errors.js";

export interface MediaTooLargeErrorMeta {
  /** The byte ceiling that was exceeded (`maxBytes` option or Meta's per-type limit). */
  maxBytes: number;
  /**
   * Bytes observed: Meta's reported `file_size`, the `Content-Length`
   * header, or the running count when the body overran mid-read.
   */
  actualBytes?: number;
  /** Meta media id when known. */
  mediaId?: string;
}

/**
 * Media payload is over the allowed size: a download whose reported
 * or streamed size exceeds `maxBytes`. The SDK stops reading the body
 * as soon as the ceiling is crossed, so an oversized or hostile
 * response is never fully buffered. Subclass of `CapabilityError`
 * (`code: "CAPABILITY"`) so existing catch sites keep working.
 */
export class MediaTooLargeError extends CapabilityError {
  public readonly maxBytes: number;
  public readonly actualBytes: number | undefined;
  public readonly mediaId: string | undefined;

  constructor(meta: MediaTooLargeErrorMeta, options?: { cause?: unknown }) {
    super(
      meta.actualBytes !== undefined
        ? `Media payload of ${meta.actualBytes} bytes exceeds the ${meta.maxBytes}-byte limit.`
        : `Media payload exceeds the ${meta.maxBytes}-byte limit.`,
      {},
      options
    );
    this.name = "MediaTooLargeError";
    this.maxBytes = meta.maxBytes;
    this.actualBytes = meta.actualBytes;
    this.mediaId = meta.mediaId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Why a media URL was refused before the bearer token was attached. */
export type UntrustedMediaUrlReason =
  "invalid_url" | "insecure_scheme" | "untrusted_host" | "too_many_redirects";

/**
 * The SDK refused to send the WABA bearer token to a media URL: it is
 * not `https:`, its host is not a Meta media host, or a redirect
 * pointed somewhere that fails those checks. Raised before any request
 * carrying the token is made. Carries the host only — never the query
 * string (a signed credential). `code: "UNKNOWN"` (input-validation
 * convention shared with the message builders).
 */
export class UntrustedMediaUrlError extends WhatsAppError {
  public readonly reason: UntrustedMediaUrlReason;
  /** Host of the refused URL, when it could be parsed. */
  public readonly host: string | undefined;

  constructor(reason: UntrustedMediaUrlReason, host?: string, options?: { cause?: unknown }) {
    const where = host !== undefined ? ` (host ${host})` : "";
    const why: Record<UntrustedMediaUrlReason, string> = {
      invalid_url: "is not a valid URL",
      insecure_scheme: "does not use https:",
      untrusted_host: "is not a Meta media host",
      too_many_redirects: "redirected too many times",
    };
    super(
      "UNKNOWN",
      `Refusing to send the bearer token: media URL${where} ${why[reason]}.`,
      options
    );
    this.name = "UntrustedMediaUrlError";
    this.reason = reason;
    this.host = host;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Upload MIME type is not one Meta documents as supported for the
 * selected media family (e.g. `image/gif`, `audio/wav`), or contradicts
 * an explicit `family` hint. Raised before the upload request.
 * Subclass of `CapabilityError` (Meta reports the same failure as
 * `131053`).
 */
export class UnsupportedMediaTypeError extends CapabilityError {
  public readonly mimeType: string;
  public readonly family: string | undefined;

  constructor(mimeType: string, family?: string, options?: { cause?: unknown }) {
    super(
      family !== undefined
        ? `uploadMedia: MIME type "${mimeType}" is not supported by Meta for ${family} media.`
        : `uploadMedia: MIME type "${mimeType}" is not supported by Meta.`,
      {},
      options
    );
    this.name = "UnsupportedMediaTypeError";
    this.mimeType = mimeType;
    this.family = family;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
