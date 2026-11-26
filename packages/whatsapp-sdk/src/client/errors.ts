import {
  AccountRestrictedError,
  AuthenticationError,
  CapabilityError,
  OptOutError,
  PermissionError,
  RateLimitError,
  TemplateError,
  TransientError,
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
 * Canonical Meta reference for every code below.
 *
 * @see https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
 */

/**
 * Meta throttling codes that clear within seconds — safe to retry
 * inside a single call's backoff budget.
 */
const RETRYABLE_RATE_LIMIT_CODES = new Set<number>([
  4, // API Too Many Calls — app-level throughput limit
  80007, // Rate limit issues — WABA-level limit (e.g. 200 template reads / hour)
  130429, // Rate limit hit — Cloud API throughput
  131056, // (Business Account, Consumer Account) pair rate limit hit
]);

/**
 * Meta throttling codes whose enforcement window is hours or days,
 * that are scoped to one recipient, or that reflect a quality
 * restriction. Still `RateLimitError` (same consumer branch: queue /
 * back off) but `isRetryableError` returns `false` so the SDK does
 * not burn its backoff budget — or, for `131048`, add more flagged
 * sends on a number that is already restricted.
 */
const NON_RETRYABLE_RATE_LIMIT_CODES = new Set<number>([
  131048, // Spam rate limit — sending restricted on this number; check quality in WhatsApp Manager
  131049, // Not delivered to maintain healthy ecosystem engagement (per-user marketing)
  131064, // Messaging limit reduced after template-classification violations
  131066, // Not delivered for template quality / max price (replaces 131049 from March 2027)
  133016, // Registration / deregistration attempted too many times
]);

/**
 * Meta's "temporary — try again" codes. Mapped to `TransientError`
 * and retried by the default policy. For `POST /messages` an
 * exhausted `TransientError` is unknown-state (the send MAY have
 * gone through, notably for `131000`).
 */
const TRANSIENT_CODES = new Set<number>([
  1, // Invalid request or possible server error — check the status page
  2, // Temporary due to downtime or overload
  131000, // Message failed to send due to an unknown error — try again
  131016, // A service is temporarily unavailable
  131057, // Business Account in maintenance mode (e.g. throughput upgrade)
  133004, // Server temporarily unavailable
  2494100, // Phone number in maintenance mode — try again in a few minutes
]);

/**
 * The account or phone number, not the request, is the problem:
 * integrity enforcement, billing, or phone-number configuration.
 * Needs operator action; never retried in-call.
 */
const ACCOUNT_RESTRICTED_CODES = new Set<number>([
  33, // The business phone number has been deleted
  368, // Temporarily blocked for policies violations
  130497, // Business Account is restricted from messaging users in this country
  131031, // Business Account has been locked
  131037, // 555 business phone number has no approved display name
  131042, // Payment method error — review billing setup
  131045, // Phone number registration error
  133010, // Phone number not registered on the WhatsApp Business Platform
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

/**
 * Meta error code 130403 — this business has blocked the user on
 * WhatsApp. Meta: do not retry; unblock the user first.
 */
const RECIPIENT_BLOCKED_CODE = 130403;

/**
 * Meta error code 134102 — template unavailable for use (Marketing
 * Messages). Meta returns it on HTTP 500, but it is permanent.
 */
const TEMPLATE_UNAVAILABLE_CODE = 134102;

const AUTH_CODES = new Set<number>([
  0, // AuthException — unable to authenticate the app user
  190, // Invalid OAuth access token (subcodes: 463 expired, 467 invalid, 492 changed)
  200, // No access token provided — distinct from 190
]);

/** Meta documents 200–299 as "permission not granted or removed"; 200 itself is auth. */
function isPermissionRangeCode(code: number): boolean {
  return code > 200 && code <= 299;
}

const PERMISSION_CODES = new Set<number>([
  3, // API Method — capability or permissions issue
  10, // Permission denied — permission not granted or removed
  131005, // Access denied — permission not granted or removed (WhatsApp-specific)
]);

/**
 * Request-shape / content problems, or a request this sender cannot
 * make as sent. Permanent for the payload as sent; fix the request,
 * don't retry it.
 */
const CAPABILITY_CODES = new Set<number>([
  100, // Invalid parameter / API Unknown
  131008, // Required parameter is missing
  131009, // Parameter value is not valid
  131021, // Sender and recipient phone number are the same
  131051, // Unsupported message type
  131052, // Media download error (Meta could not fetch the media URL)
  131053, // Media upload error (unsupported type / undownloadable) — NOT a throttle
  131063, // Marketing templates disabled on Cloud API — use the Marketing Messages API
  131065, // Max-price delivery not available in the recipient's country (Marketing Messages)
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
    return new UndeliverableError(recipient ?? "<unknown>", {
      metaCode: code,
      reason: "UNREACHABLE",
    });
  }

  if (code === RECIPIENT_BLOCKED_CODE) {
    const recipient = extractRecipientFromMetaError(body);
    return new UndeliverableError(recipient ?? "<unknown>", {
      metaCode: code,
      reason: "RECIPIENT_BLOCKED",
    });
  }

  if (TRANSIENT_CODES.has(code)) {
    return new TransientError(`Graph API ${httpStatus} (#${code}): ${message}`, {
      httpStatus,
      metaCode: code,
    });
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

  if (PERMISSION_CODES.has(code) || isPermissionRangeCode(code)) {
    return new PermissionError(message, { metaCode: code });
  }

  if (CAPABILITY_CODES.has(code)) {
    return new CapabilityError(message, { metaCode: code });
  }

  if (looksLikeTemplateCode(code) || code === TEMPLATE_UNAVAILABLE_CODE) {
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

/** Whether a Meta code is one of the "temporary — try again" codes mapped to `TransientError`. */
export function isTransientMetaCode(code: number): boolean {
  return TRANSIENT_CODES.has(code);
}

/** Whether the SDK should retry on this typed error. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof RateLimitError && typeof err.metaCode === "number") {
    return RETRYABLE_RATE_LIMIT_CODES.has(err.metaCode);
  }
  if (err instanceof TransientError && typeof err.metaCode === "number") {
    return TRANSIENT_CODES.has(err.metaCode);
  }
  return false;
}

/** Whether the given HTTP status code is transient (retryable). */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}
