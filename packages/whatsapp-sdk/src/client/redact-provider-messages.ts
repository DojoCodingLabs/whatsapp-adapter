import { WhatsAppError, type WhatsAppErrorCode } from "../types/errors.js";

/**
 * Error codes whose `message` can carry text Meta wrote (`error.message`
 * from the Graph envelope, or a raw non-JSON body) or the recipient
 * identifier (`WindowClosedError` / `UndeliverableError`). SDK-authored
 * messages (`TRANSIENT`, `NETWORK`, `ABORTED`, `MEDIA_EXPIRED`,
 * `MISSING_CREDENTIALS`, …) are left alone.
 */
const PROVIDER_TEXT_CODES: ReadonlySet<WhatsAppErrorCode> = new Set<WhatsAppErrorCode>([
  "RATE_LIMIT",
  "ACCOUNT_RESTRICTED",
  "AUTHENTICATION",
  "PERMISSION",
  "CAPABILITY",
  "TEMPLATE",
  "UNKNOWN",
  "WINDOW_CLOSED",
  "UNDELIVERABLE",
  "OPT_OUT",
]);

const REDACTED_MARK = "provider message redacted";

/**
 * Last-4 redaction of a recipient identifier (phone number or BSUID),
 * matching `OptOutError.recipient` (`***1234`).
 */
export function redactRecipientId(value: string): string {
  const tail = value.replace(/[^A-Za-z0-9]/g, "");
  return `***${tail.slice(-4)}`;
}

function numberField(err: WhatsAppError, field: string): number | undefined {
  const v = (err as unknown as Record<string, unknown>)[field];
  return typeof v === "number" ? v : undefined;
}

function genericMessage(err: WhatsAppError): string {
  if (err.code === "WINDOW_CLOSED") {
    return "24-hour customer-service window is closed for this recipient; only approved templates may be sent.";
  }
  const metaCode = numberField(err, "metaCode");
  if (err.code === "UNDELIVERABLE") {
    return `Message undeliverable to this recipient${metaCode !== undefined ? ` (Meta code ${metaCode})` : ""}.`;
  }
  if (err.code === "OPT_OUT") {
    return "Recipient has opted out.";
  }
  const parts: string[] = [];
  const httpStatus = numberField(err, "httpStatus");
  if (metaCode !== undefined) parts.push(`Meta code ${metaCode}`);
  if (httpStatus !== undefined) parts.push(`HTTP ${httpStatus}`);
  const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `WhatsApp Cloud API error${detail}; ${REDACTED_MARK}.`;
}

function setOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: Object.prototype.propertyIsEnumerable.call(target, key),
  });
}

/**
 * Replace provider-authored text in a typed error with a generic
 * phrase, in place. Keeps the class, `code`, `metaCode`, `httpStatus`,
 * `subcode`, `retryAfterMs` and `cause` so branching and retry logic
 * are unaffected. For `WindowClosedError` / `UndeliverableError` the
 * `customerWaId` field is reduced to a last-4 form (`***1234`) so no
 * serializer (`toJSON`, pino's err serializer, …) can emit the full
 * recipient.
 *
 * Applied by `WhatsAppClient` (and `MockWhatsAppClient`) when the
 * `redactProviderMessages` option is `true`. Non-`WhatsAppError`
 * values pass through untouched.
 */
export function redactProviderMessage<E>(err: E): E {
  if (!(err instanceof WhatsAppError)) return err;
  if (!PROVIDER_TEXT_CODES.has(err.code)) return err;
  const original = err.message;
  const replacement = genericMessage(err);
  if (original === replacement) return err;
  setOwn(err, "message", replacement);
  if (typeof err.stack === "string") {
    // The first stack line embeds the original message.
    const idx = err.stack.indexOf(original);
    setOwn(
      err,
      "stack",
      idx === -1
        ? `${err.name}: ${replacement}`
        : err.stack.slice(0, idx) + replacement + err.stack.slice(idx + original.length)
    );
  }
  const waId = (err as unknown as { customerWaId?: unknown }).customerWaId;
  if (typeof waId === "string" && !waId.startsWith("***")) {
    setOwn(err, "customerWaId", redactRecipientId(waId));
  }
  return err;
}
