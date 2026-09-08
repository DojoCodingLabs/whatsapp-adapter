export type WhatsAppErrorCode =
  | "MISSING_CREDENTIALS"
  | "RATE_LIMIT"
  | "WINDOW_CLOSED"
  | "UNDELIVERABLE"
  | "WEBHOOK_SIGNATURE"
  | "TEMPLATE"
  | "MOCK_MODE"
  | "AUTHENTICATION"
  | "PERMISSION"
  | "CAPABILITY"
  | "OPT_OUT"
  | "ACCOUNT_RESTRICTED"
  | "TRANSIENT"
  | "NETWORK"
  | "ABORTED"
  | "UNKNOWN";

export interface WhatsAppErrorOptions {
  cause?: unknown;
}

export class WhatsAppError extends Error {
  public readonly code: WhatsAppErrorCode;

  constructor(code: WhatsAppErrorCode, message: string, options?: WhatsAppErrorOptions) {
    super(message);
    this.name = "WhatsAppError";
    this.code = code;
    if (options?.cause !== undefined) {
      (this as unknown as { cause: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): { name: string; code: WhatsAppErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export type CredentialField = "phoneNumberId" | "wabaId" | "token" | "appSecret";

export class MissingCredentialsError extends WhatsAppError {
  public override readonly code = "MISSING_CREDENTIALS" as const;
  public readonly missingFields: ReadonlyArray<CredentialField>;

  constructor(missingFields: ReadonlyArray<CredentialField>, options?: WhatsAppErrorOptions) {
    super(
      "MISSING_CREDENTIALS",
      `WhatsAppClient is missing required credential field(s): ${missingFields.join(", ")}`,
      options
    );
    this.name = "MissingCredentialsError";
    this.missingFields = missingFields;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public override toJSON(): {
    name: string;
    code: "MISSING_CREDENTIALS";
    message: string;
    missingFields: ReadonlyArray<CredentialField>;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      missingFields: this.missingFields,
    };
  }
}

export interface RateLimitErrorMeta {
  /**
   * Meta error code. Retryable within a single call's backoff:
   * `4`, `80007`, `130429`, `131048`, `131056`. Non-retryable
   * (enforcement window is hours/days, or per-recipient):
   * `131049`, `131064`, `133016`. `undefined` when the limit came
   * from an HTTP 429 without a Meta envelope.
   */
  metaCode?: number;
  /** Retry hint in milliseconds, derived from headers or backoff. */
  retryAfterMs?: number;
}

export class RateLimitError extends WhatsAppError {
  public override readonly code = "RATE_LIMIT" as const;
  public readonly metaCode: number | undefined;
  public readonly retryAfterMs: number | undefined;

  constructor(message: string, meta: RateLimitErrorMeta = {}, options?: WhatsAppErrorOptions) {
    super("RATE_LIMIT", message, options);
    this.name = "RateLimitError";
    this.metaCode = meta.metaCode;
    this.retryAfterMs = meta.retryAfterMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WindowClosedError extends WhatsAppError {
  public override readonly code = "WINDOW_CLOSED" as const;
  public readonly customerWaId: string;

  constructor(customerWaId: string, options?: WhatsAppErrorOptions) {
    super(
      "WINDOW_CLOSED",
      `24-hour customer-service window is closed for ${customerWaId}; only approved templates may be sent.`,
      options
    );
    this.name = "WindowClosedError";
    this.customerWaId = customerWaId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Meta error code 131026 — "Message Undeliverable". The recipient is
 * not on WhatsApp, has not accepted the latest Terms of Service, is
 * using an outdated WhatsApp client, or has otherwise become
 * unreachable. Distinct from {@link WindowClosedError} (code 131047,
 * the 24h re-engagement gate) — sending a template will NOT recover
 * from this; only the recipient updating / installing WhatsApp will.
 */
export class UndeliverableError extends WhatsAppError {
  public override readonly code = "UNDELIVERABLE" as const;
  public readonly customerWaId: string;

  constructor(customerWaId: string, options?: WhatsAppErrorOptions) {
    super(
      "UNDELIVERABLE",
      `Message undeliverable to ${customerWaId}: recipient not on WhatsApp, has not accepted current ToS, or is using an outdated client.`,
      options
    );
    this.name = "UndeliverableError";
    this.customerWaId = customerWaId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by template send methods when the configured
 * `OptInRegistry` reports the recipient as opted out. Carries
 * a last-4-digit redacted recipient (PII-safe for logs) and
 * an optional `category` naming the scope of the opt-out.
 *
 * Also produced by `mapMetaError` for Meta code `131050` (the
 * recipient asked WhatsApp to stop marketing messages from this
 * business). In that case `metaCode === 131050` and the opt-out is
 * authoritative on Meta's side — record it in your `OptInRegistry`
 * and do not retry.
 */
export class OptOutError extends WhatsAppError {
  public override readonly code = "OPT_OUT" as const;
  /** Last-4-digit redaction of the recipient phone (`***1234`). */
  public readonly recipient: string;
  /** Template category the opt-out applies to. `undefined` for global opt-outs. */
  public readonly category: "MARKETING" | "UTILITY" | "AUTHENTICATION" | undefined;
  /** Meta error code when the opt-out was reported by Meta (`131050`); `undefined` for registry pre-flight. */
  public readonly metaCode: number | undefined;

  constructor(
    recipient: string,
    category?: "MARKETING" | "UTILITY" | "AUTHENTICATION",
    options?: WhatsAppErrorOptions & { metaCode?: number }
  ) {
    const redacted = redactRecipient(recipient);
    const message =
      category !== undefined
        ? `Recipient ${redacted} has opted out of ${category}.`
        : `Recipient ${redacted} has opted out.`;
    super("OPT_OUT", message, options);
    this.name = "OptOutError";
    this.recipient = redacted;
    this.category = category;
    this.metaCode = options?.metaCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function redactRecipient(recipient: string): string {
  const digits = recipient.replace(/\D/g, "");
  if (digits.length <= 4) return `***${digits}`;
  return `***${digits.slice(-4)}`;
}

export class WebhookSignatureError extends WhatsAppError {
  public override readonly code = "WEBHOOK_SIGNATURE" as const;

  constructor(message = "Webhook signature verification failed", options?: WhatsAppErrorOptions) {
    super("WEBHOOK_SIGNATURE", message, options);
    this.name = "WebhookSignatureError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface TemplateErrorMeta {
  /**
   * Meta error code when the failure was reported by Meta
   * (`132000` param count, `132001` does not exist / not approved,
   * `132005` hydrated text too long, `132007` format policy,
   * `132012` param format, `132015` paused, `132016` disabled,
   * `132018` validation). `undefined` for SDK-side pre-flight
   * failures (`validateAgainst`, builder validation).
   */
  metaCode?: number;
}

export class TemplateError extends WhatsAppError {
  public override readonly code = "TEMPLATE" as const;
  public readonly templateName: string | undefined;
  public readonly metaCode: number | undefined;

  constructor(
    message: string,
    templateName?: string,
    options?: WhatsAppErrorOptions & TemplateErrorMeta
  ) {
    super("TEMPLATE", message, options);
    this.name = "TemplateError";
    this.templateName = templateName;
    this.metaCode = options?.metaCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MockModeError extends WhatsAppError {
  public override readonly code = "MOCK_MODE" as const;

  constructor(message: string, options?: WhatsAppErrorOptions) {
    super("MOCK_MODE", message, options);
    this.name = "MockModeError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface AuthenticationErrorMeta {
  /** Meta error code (typically 190). */
  metaCode?: number;
  /** Meta error_subcode (e.g. 463 expired, 467 invalid, 492 changed). */
  subcode?: number;
}

export class AuthenticationError extends WhatsAppError {
  public override readonly code = "AUTHENTICATION" as const;
  public readonly metaCode: number | undefined;
  public readonly subcode: number | undefined;

  constructor(message: string, meta: AuthenticationErrorMeta = {}, options?: WhatsAppErrorOptions) {
    super("AUTHENTICATION", message, options);
    this.name = "AuthenticationError";
    this.metaCode = meta.metaCode;
    this.subcode = meta.subcode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface PermissionErrorMeta {
  /** Meta error code (200, 210, 230, 294, or 299 in v1). */
  metaCode?: number;
}

export class PermissionError extends WhatsAppError {
  public override readonly code = "PERMISSION" as const;
  public readonly metaCode: number | undefined;

  constructor(message: string, meta: PermissionErrorMeta = {}, options?: WhatsAppErrorOptions) {
    super("PERMISSION", message, options);
    this.name = "PermissionError";
    this.metaCode = meta.metaCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface CapabilityErrorMeta {
  /** Meta error code (typically 100). */
  metaCode?: number;
}

export class CapabilityError extends WhatsAppError {
  public override readonly code = "CAPABILITY" as const;
  public readonly metaCode: number | undefined;

  constructor(message: string, meta: CapabilityErrorMeta = {}, options?: WhatsAppErrorOptions) {
    super("CAPABILITY", message, options);
    this.name = "CapabilityError";
    this.metaCode = meta.metaCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface AccountRestrictedErrorMeta {
  /**
   * Meta error code: `368` (temporarily blocked for policy
   * violations), `130497` (restricted from messaging users in this
   * country), `131031` (account locked / integrity review).
   */
  metaCode?: number;
}

/**
 * Meta's integrity group — the WABA or phone number is blocked,
 * locked, or restricted. Nothing about the individual request is
 * wrong and no retry will help; orchestrators should halt the
 * campaign and surface to an operator (check WhatsApp Manager /
 * Business Support Home).
 */
export class AccountRestrictedError extends WhatsAppError {
  public override readonly code = "ACCOUNT_RESTRICTED" as const;
  public readonly metaCode: number | undefined;

  constructor(
    message: string,
    meta: AccountRestrictedErrorMeta = {},
    options?: WhatsAppErrorOptions
  ) {
    super("ACCOUNT_RESTRICTED", message, options);
    this.name = "AccountRestrictedError";
    this.metaCode = meta.metaCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface TransientErrorMeta {
  /** HTTP status of the final failed attempt (408 / 5xx). */
  httpStatus?: number;
  /** `Retry-After` hint from the final response, in milliseconds. */
  retryAfterMs?: number;
  /** Total attempts made before giving up. */
  attempts?: number;
}

/**
 * The SDK exhausted its retry budget on a transient HTTP failure
 * (408 / 5xx without a Meta rate-limit code). The request MAY have
 * reached Meta — for `POST /messages` treat the send as
 * unknown-state, not failed, before re-sending.
 *
 * The per-attempt marker (`TransientHttpError`) is internal to the
 * retry loop; consumers only ever see this class.
 */
export class TransientError extends WhatsAppError {
  public override readonly code = "TRANSIENT" as const;
  public readonly httpStatus: number | undefined;
  public readonly retryAfterMs: number | undefined;
  public readonly attempts: number | undefined;

  constructor(message: string, meta: TransientErrorMeta = {}, options?: WhatsAppErrorOptions) {
    super("TRANSIENT", message, options);
    this.name = "TransientError";
    this.httpStatus = meta.httpStatus;
    this.retryAfterMs = meta.retryAfterMs;
    this.attempts = meta.attempts;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * `fetch` itself failed (DNS, TCP, TLS, connection reset) on every
 * attempt. `cause` carries the runtime's original `TypeError`.
 * The request never reached Meta.
 */
export class NetworkError extends WhatsAppError {
  public override readonly code = "NETWORK" as const;

  constructor(message: string, options?: WhatsAppErrorOptions) {
    super("NETWORK", message, options);
    this.name = "NetworkError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The caller's `AbortSignal` fired. Surfaces immediately — the SDK
 * does not retry a cancellation the consumer asked for. `cause`
 * carries the runtime's `AbortError`.
 */
export class RequestAbortedError extends WhatsAppError {
  public override readonly code = "ABORTED" as const;

  constructor(message = "Request aborted by caller", options?: WhatsAppErrorOptions) {
    super("ABORTED", message, options);
    this.name = "RequestAbortedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
