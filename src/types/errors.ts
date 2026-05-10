export type WhatsAppErrorCode =
  | "MISSING_CREDENTIALS"
  | "RATE_LIMIT"
  | "WINDOW_CLOSED"
  | "WEBHOOK_SIGNATURE"
  | "TEMPLATE"
  | "MOCK_MODE"
  | "AUTHENTICATION"
  | "PERMISSION"
  | "CAPABILITY"
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
  /** Meta error code (e.g., 131056, 130429, 131048). */
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

export class WebhookSignatureError extends WhatsAppError {
  public override readonly code = "WEBHOOK_SIGNATURE" as const;

  constructor(message = "Webhook signature verification failed", options?: WhatsAppErrorOptions) {
    super("WEBHOOK_SIGNATURE", message, options);
    this.name = "WebhookSignatureError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TemplateError extends WhatsAppError {
  public override readonly code = "TEMPLATE" as const;
  public readonly templateName: string | undefined;

  constructor(message: string, templateName?: string, options?: WhatsAppErrorOptions) {
    super("TEMPLATE", message, options);
    this.name = "TemplateError";
    this.templateName = templateName;
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
