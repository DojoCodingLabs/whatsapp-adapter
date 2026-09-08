import {
  AccountRestrictedError,
  AuthenticationError,
  CapabilityError,
  OptOutError,
  PermissionError,
  RateLimitError,
  TemplateError,
  UndeliverableError,
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

/**
 * Meta throttling codes that clear within seconds — safe to retry
 * inside a single call's backoff budget.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const RETRYABLE_RATE_LIMIT_CODES = new Set<number>([
  4, // API Too Many Calls — app-level throughput limit
  80007, // Rate limit issues — WABA-level limit (e.g. 200 template reads / hour)
  130429, // Rate limit hit — Cloud API throughput
  131048, // Spam rate limit hit — quality-based throttle
  131056, // (Business Account, Consumer Account) pair rate limit hit
]);

/**
 * Meta throttling codes whose enforcement window is hours or days,
 * or which are scoped to one recipient. Still `RateLimitError`
 * (same consumer branch: queue / back off) but `isRetryableError`
 * returns `false` so the SDK does not burn its backoff budget.
 */
const NON_RETRYABLE_RATE_LIMIT_CODES = new Set<number>([
  131049, // Per-user marketing message limit (healthy-ecosystem engagement)
  131064, // Messaging limit reduced after template-classification violations
  133016, // Registration / deregistration attempted too many times
]);

/**
 * Meta integrity codes — the account, not the request, is the
 * problem. Never retried.
 */
const ACCOUNT_RESTRICTED_CODES = new Set<number>([
  368, // Temporarily blocked for policies violations
  130497, // Business Account is restricted from messaging users in this country
  131031, // Business Account has been locked
]);

/**
 * Meta error code 131050 — the recipient asked WhatsApp to stop
 * receiving marketing messages from this business. Authoritative;
 * do not retry.
 */
const MARKETING_OPT_OUT_CODE = 131050;

/**
 * Meta error code 131047 — re-engagement gate, the 24-hour
 * customer-service window is closed and only an approved template
 * may be sent. Distinct from 131026 (Message Undeliverable) — a
 * template send WILL clear 131047 but NOT 131026.
 */
const WINDOW_CLOSED_CODE = 131047;

/**
 * Meta error code 131026 — Message Undeliverable. Recipient is not
 * on WhatsApp, has not accepted current ToS, or is using an
 * outdated WhatsApp client. Sending a template will NOT recover.
 */
const UNDELIVERABLE_CODE = 131026;

const AUTH_CODES = new Set<number>([
  0, // AuthException — unable to authenticate the app user
  190, // Invalid OAuth access token (subcodes: 463 expired, 467 invalid, 492 changed)
]);

const PERMISSION_CODES = new Set<number>([
  3, // API Method — capability or permissions issue
  10, // Permission denied — permission not granted or removed
  200, // Permissions error (general)
  210, // User not visible / phone-level permission
  230, // Permission disabled
  294, // Permission for this action is required
  299, // Permission denied for this action
  131005, // Access denied — permission not granted or removed (WhatsApp-specific)
]);

/**
 * Request-shape / content problems. Permanent for the payload as
 * sent; fix the request, don't retry it.
 */
const CAPABILITY_CODES = new Set<number>([
  100, // Invalid parameter / API Unknown
  131008, // Required parameter is missing
  131009, // Parameter value is not valid
  131051, // Unsupported message type
  131052, // Media download error (Meta could not fetch the media URL)
  131053, // Media upload error (unsupported type / undownloadable) — NOT a throttle
]);

function isMetaErrorEnvelope(value: unknown): value is MetaErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { error?: unknown };
  if (typeof v.error !== "object" || v.error === null) return false;
  const e = v.error as { code?: unknown; message?: unknown };
  return typeof e.code === "number" && typeof e.message === "string";
}

/** Meta `error.code` from a parsed body, or `undefined` when the body isn't a Meta envelope. */
export function extractMetaCodeFromBody(body: unknown): number | undefined {
  return isMetaErrorEnvelope(body) ? body.error.code : undefined;
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

  if (RETRYABLE_RATE_LIMIT_CODES.has(code) || NON_RETRYABLE_RATE_LIMIT_CODES.has(code)) {
    return new RateLimitError(message, { metaCode: code });
  }

  if (code === WINDOW_CLOSED_CODE) {
    const recipient = extractRecipientFromMetaError(body);
    return new WindowClosedError(recipient ?? "<unknown>");
  }

  if (code === UNDELIVERABLE_CODE) {
    const recipient = extractRecipientFromMetaError(body);
    return new UndeliverableError(recipient ?? "<unknown>");
  }

  if (code === MARKETING_OPT_OUT_CODE) {
    const recipient = extractRecipientFromMetaError(body);
    return new OptOutError(recipient ?? "", "MARKETING", { metaCode: code });
  }

  if (ACCOUNT_RESTRICTED_CODES.has(code)) {
    return new AccountRestrictedError(message, { metaCode: code });
  }

  if (AUTH_CODES.has(code)) {
    const subcode = body.error.error_subcode;
    return new AuthenticationError(message, {
      metaCode: code,
      ...(typeof subcode === "number" ? { subcode } : {}),
    });
  }

  if (PERMISSION_CODES.has(code)) {
    return new PermissionError(message, { metaCode: code });
  }

  if (CAPABILITY_CODES.has(code)) {
    return new CapabilityError(message, { metaCode: code });
  }

  if (looksLikeTemplateCode(code)) {
    return new TemplateError(message, undefined, { metaCode: code });
  }

  return new WhatsAppError("UNKNOWN", `Graph API ${httpStatus} (#${code}): ${message}`);
}

/**
 * Whether a Meta code belongs to the rate-limit family at all
 * (retryable or not). Used by the transport to upgrade a
 * `TransientHttpError` carrying a Meta envelope into a
 * `RateLimitError` once retries are exhausted.
 */
export function isRateLimitMetaCode(code: number): boolean {
  return RETRYABLE_RATE_LIMIT_CODES.has(code) || NON_RETRYABLE_RATE_LIMIT_CODES.has(code);
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
