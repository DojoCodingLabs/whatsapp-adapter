import {
  RateLimitError,
  TemplateError,
  WhatsAppError,
  WindowClosedError,
} from "../types/errors.js";

/** Meta's standard error envelope shape (Cloud API). */
export interface MetaErrorEnvelope {
  error: {
    code: number;
    message: string;
    error_subcode?: number;
    error_data?: {
      messaging_product?: string;
      details?: string;
      [key: string]: unknown;
    };
    fbtrace_id?: string;
  };
}

const RETRYABLE_RATE_LIMIT_CODES = new Set<number>([
  130429, // Generic rate limit
  131048, // Spam-detection rate limit
  131056, // Pair rate limit
  131053, // Media-upload throttle
]);

const WINDOW_CLOSED_CODE = 131026;

function isMetaErrorEnvelope(value: unknown): value is MetaErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { error?: unknown };
  if (typeof v.error !== "object" || v.error === null) return false;
  const e = v.error as { code?: unknown; message?: unknown };
  return typeof e.code === "number" && typeof e.message === "string";
}

function looksLikeTemplateCode(code: number): boolean {
  return code >= 132_000 && code < 133_000;
}

/**
 * Map a Graph API error response to a typed `WhatsAppError`.
 *
 * Pure: takes the HTTP status and parsed body (or raw string when not JSON),
 * returns the typed error. The retry decision lives separately in `retry.ts`
 * — this function only does mapping.
 */
export function mapMetaError(httpStatus: number, body: unknown): WhatsAppError {
  if (!isMetaErrorEnvelope(body)) {
    const fallbackMessage =
      typeof body === "string" && body.length > 0
        ? `Graph API ${httpStatus}: ${body.slice(0, 200)}`
        : `Graph API ${httpStatus} with non-Meta-shaped error body`;
    return new WhatsAppError("UNKNOWN", fallbackMessage);
  }

  const { code, message } = body.error;

  if (RETRYABLE_RATE_LIMIT_CODES.has(code)) {
    return new RateLimitError(message, { metaCode: code });
  }

  if (code === WINDOW_CLOSED_CODE) {
    const recipient = extractRecipientFromMetaError(body);
    return new WindowClosedError(recipient ?? "<unknown>");
  }

  if (looksLikeTemplateCode(code)) {
    return new TemplateError(message);
  }

  return new WhatsAppError("UNKNOWN", `Graph API ${httpStatus} (#${code}): ${message}`);
}

function extractRecipientFromMetaError(body: MetaErrorEnvelope): string | undefined {
  const data = body.error.error_data;
  if (!data) return undefined;
  const candidate =
    (data["recipient_phone_number"] as string | undefined) ??
    (data["customer_wa_id"] as string | undefined);
  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }
  return undefined;
}

/** Whether the SDK should retry on this typed error. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof RateLimitError && typeof err.metaCode === "number") {
    return RETRYABLE_RATE_LIMIT_CODES.has(err.metaCode);
  }
  return false;
}

/** Whether the given HTTP status code is transient (retryable). */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}
