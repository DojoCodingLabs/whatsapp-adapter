import type {
  AccountAlertEvent,
  AccountReviewEvent,
  IncomingMessageKind,
  MessageEvent,
  PhoneNumberQualityUpdateEvent,
  StatusEvent,
  TemplateCategoryUpdateEvent,
  TemplateQualityUpdateEvent,
  TemplateStatusEvent,
  UnknownEvent,
  WhatsAppEvent,
} from "./events.js";

interface MetaEnvelope {
  object?: string;
  entry?: ReadonlyArray<MetaEnvelopeEntry>;
}

interface MetaEnvelopeEntry {
  id?: string;
  changes?: ReadonlyArray<MetaEnvelopeChange>;
}

interface MetaEnvelopeChange {
  field?: string;
  value?: Record<string, unknown>;
}

const KNOWN_INCOMING_KINDS: ReadonlySet<string> = new Set([
  "text",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "location",
  "contacts",
  "button",
  "order",
  "reaction",
  "system",
  "unsupported",
  "interactive",
]);

/**
 * Parse a Meta webhook payload (already JSON-decoded) into a flat
 * `ReadonlyArray<WhatsAppEvent>`. Pure, never throws, surfaces
 * unrecognised top-level fields as `{ kind: "unknown" }` so consumers
 * can log and the SDK can extend later without breaking changes.
 */
export function parseWebhookPayload(body: unknown): ReadonlyArray<WhatsAppEvent> {
  const envelope = body as MetaEnvelope | null | undefined;
  if (envelope === null || envelope === undefined || typeof envelope !== "object") return [];
  const entries: ReadonlyArray<MetaEnvelopeEntry> = Array.isArray(envelope.entry)
    ? (envelope.entry as ReadonlyArray<MetaEnvelopeEntry>)
    : [];
  if (entries.length === 0) return [];

  const out: WhatsAppEvent[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const wabaId = typeof entry.id === "string" ? entry.id : "";
    const changes: ReadonlyArray<MetaEnvelopeChange> = Array.isArray(entry.changes)
      ? (entry.changes as ReadonlyArray<MetaEnvelopeChange>)
      : [];
    for (const change of changes) {
      if (change === null || typeof change !== "object") continue;
      const field = typeof change.field === "string" ? change.field : "";
      const value = change.value ?? {};
      out.push(...parseChange(wabaId, field, value));
    }
  }
  return out;
}

function parseChange(
  wabaId: string,
  field: string,
  value: Record<string, unknown>
): ReadonlyArray<WhatsAppEvent> {
  const metadata = (value["metadata"] ?? {}) as Record<string, unknown>;
  const phoneNumberId =
    typeof metadata["phone_number_id"] === "string" ? metadata["phone_number_id"] : undefined;
  const displayPhoneNumber =
    typeof metadata["display_phone_number"] === "string"
      ? metadata["display_phone_number"]
      : undefined;
  const baseTimestamp = Date.now();

  switch (field) {
    case "messages":
      return parseMessagesField(value, {
        wabaId,
        phoneNumberId,
        displayPhoneNumber,
        baseTimestamp,
      });
    case "message_template_status_update":
      return [parseTemplateStatus(value, wabaId, baseTimestamp)];
    case "message_template_quality_update":
      return [parseTemplateQuality(value, wabaId, baseTimestamp)];
    case "template_category_update":
      return [parseTemplateCategory(value, wabaId, baseTimestamp)];
    case "phone_number_quality_update":
      return [parsePhoneNumberQuality(value, wabaId, phoneNumberId, baseTimestamp)];
    case "account_alerts":
      return [parseAccountAlert(value, wabaId, baseTimestamp)];
    case "account_review_update":
      return [parseAccountReview(value, wabaId, baseTimestamp)];
    default: {
      const ev: UnknownEvent = {
        kind: "unknown",
        wabaId,
        timestamp: baseTimestamp,
        field,
        value,
      };
      return [ev];
    }
  }
}

interface ParseCtx {
  wabaId: string;
  phoneNumberId: string | undefined;
  displayPhoneNumber: string | undefined;
  baseTimestamp: number;
}

function parseMessagesField(
  value: Record<string, unknown>,
  ctx: ParseCtx
): ReadonlyArray<WhatsAppEvent> {
  const out: WhatsAppEvent[] = [];
  const messages = Array.isArray(value["messages"])
    ? (value["messages"] as Array<Record<string, unknown>>)
    : [];
  for (const m of messages) {
    out.push(parseInboundMessage(m, ctx));
  }
  const statuses = Array.isArray(value["statuses"])
    ? (value["statuses"] as Array<Record<string, unknown>>)
    : [];
  for (const s of statuses) {
    out.push(parseStatus(s, ctx));
  }
  return out;
}

function parseInboundMessage(m: Record<string, unknown>, ctx: ParseCtx): MessageEvent {
  const id = typeof m["id"] === "string" ? m["id"] : "";
  const from = typeof m["from"] === "string" ? m["from"] : "";
  const rawType = typeof m["type"] === "string" ? m["type"] : "unsupported";
  const type = normaliseIncomingType(rawType, m);
  const timestamp = parseTimestamp(m["timestamp"]) ?? ctx.baseTimestamp;
  const context = m["context"] as Record<string, unknown> | undefined;
  const contextId = context && typeof context["id"] === "string" ? context["id"] : undefined;
  const ev: MessageEvent = {
    kind: "message",
    wabaId: ctx.wabaId,
    timestamp,
    id,
    from,
    type,
    body: m,
  };
  if (ctx.phoneNumberId !== undefined) ev.phoneNumberId = ctx.phoneNumberId;
  if (ctx.displayPhoneNumber !== undefined) ev.displayPhoneNumber = ctx.displayPhoneNumber;
  if (contextId !== undefined) ev.contextId = contextId;
  return ev;
}

function normaliseIncomingType(rawType: string, m: Record<string, unknown>): IncomingMessageKind {
  if (rawType === "interactive") {
    const interactive = m["interactive"] as Record<string, unknown> | undefined;
    const subType =
      interactive && typeof interactive["type"] === "string" ? interactive["type"] : undefined;
    if (subType === "button_reply") return "interactive_button_reply";
    if (subType === "list_reply") return "interactive_list_reply";
    return "unsupported";
  }
  if (KNOWN_INCOMING_KINDS.has(rawType)) {
    return rawType as IncomingMessageKind;
  }
  return "unsupported";
}

function parseStatus(s: Record<string, unknown>, ctx: ParseCtx): StatusEvent {
  const id = typeof s["id"] === "string" ? s["id"] : "";
  const status = typeof s["status"] === "string" ? s["status"] : "unknown";
  const timestamp = parseTimestamp(s["timestamp"]) ?? ctx.baseTimestamp;
  const recipientId = typeof s["recipient_id"] === "string" ? s["recipient_id"] : undefined;
  const conversation = s["conversation"] as Record<string, unknown> | undefined;
  const conversationId =
    conversation && typeof conversation["id"] === "string" ? conversation["id"] : undefined;
  const pricing = s["pricing"] as Record<string, unknown> | undefined;
  const pricingCategory =
    pricing && typeof pricing["category"] === "string" ? pricing["category"] : undefined;
  const errors = Array.isArray(s["errors"])
    ? (s["errors"] as NonNullable<StatusEvent["errors"]>)
    : undefined;

  const ev: StatusEvent = {
    kind: "status",
    wabaId: ctx.wabaId,
    timestamp,
    id,
    status,
  };
  if (ctx.phoneNumberId !== undefined) ev.phoneNumberId = ctx.phoneNumberId;
  if (ctx.displayPhoneNumber !== undefined) ev.displayPhoneNumber = ctx.displayPhoneNumber;
  if (recipientId !== undefined) ev.recipientId = recipientId;
  if (conversationId !== undefined) ev.conversationId = conversationId;
  if (pricingCategory !== undefined) ev.pricingCategory = pricingCategory;
  if (errors !== undefined) {
    ev.errors = errors;
  }
  return ev;
}

function parseTemplateStatus(
  value: Record<string, unknown>,
  wabaId: string,
  ts: number
): TemplateStatusEvent {
  const ev: TemplateStatusEvent = {
    kind: "template_status",
    wabaId,
    timestamp: ts,
    templateId: pickString(value, "message_template_id") ?? pickString(value, "template_id") ?? "",
    event: pickString(value, "event") ?? "",
  };
  const name = pickString(value, "message_template_name") ?? pickString(value, "template_name");
  if (name !== undefined) ev.templateName = name;
  const language = pickString(value, "message_template_language") ?? pickString(value, "language");
  if (language !== undefined) ev.language = language;
  const reason = pickString(value, "reason");
  if (reason !== undefined) ev.reason = reason;
  return ev;
}

function parseTemplateQuality(
  value: Record<string, unknown>,
  wabaId: string,
  ts: number
): TemplateQualityUpdateEvent {
  const ev: TemplateQualityUpdateEvent = {
    kind: "template_quality",
    wabaId,
    timestamp: ts,
    templateId: pickString(value, "message_template_id") ?? "",
    newQualityScore: pickString(value, "new_quality_score") ?? "",
  };
  const previous = pickString(value, "previous_quality_score");
  if (previous !== undefined) ev.previousQualityScore = previous;
  const name = pickString(value, "message_template_name");
  if (name !== undefined) ev.templateName = name;
  return ev;
}

function parseTemplateCategory(
  value: Record<string, unknown>,
  wabaId: string,
  ts: number
): TemplateCategoryUpdateEvent {
  const ev: TemplateCategoryUpdateEvent = {
    kind: "template_category",
    wabaId,
    timestamp: ts,
    templateId: pickString(value, "message_template_id") ?? "",
    newCategory: pickString(value, "new_category") ?? "",
  };
  const previous = pickString(value, "previous_category");
  if (previous !== undefined) ev.previousCategory = previous;
  const name = pickString(value, "message_template_name");
  if (name !== undefined) ev.templateName = name;
  return ev;
}

function parsePhoneNumberQuality(
  value: Record<string, unknown>,
  wabaId: string,
  phoneNumberId: string | undefined,
  ts: number
): PhoneNumberQualityUpdateEvent {
  const ev: PhoneNumberQualityUpdateEvent = {
    kind: "phone_number_quality",
    wabaId,
    timestamp: ts,
    newQualityScore: pickString(value, "new_quality_score") ?? "",
  };
  if (phoneNumberId !== undefined) ev.phoneNumberId = phoneNumberId;
  return ev;
}

function parseAccountAlert(
  value: Record<string, unknown>,
  wabaId: string,
  ts: number
): AccountAlertEvent {
  const ev: AccountAlertEvent = {
    kind: "account_alert",
    wabaId,
    timestamp: ts,
    raw: value,
  };
  const severity = pickString(value, "alert_severity");
  if (severity !== undefined) ev.alertSeverity = severity;
  const type = pickString(value, "alert_type");
  if (type !== undefined) ev.alertType = type;
  return ev;
}

function parseAccountReview(
  value: Record<string, unknown>,
  wabaId: string,
  ts: number
): AccountReviewEvent {
  const decision = pickString(value, "decision") ?? "";
  return {
    kind: "account_review",
    wabaId,
    timestamp: ts,
    decision,
    raw: value,
  };
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

/** Meta sends `timestamp` as a string of seconds (`"1735689600"`). */
function parseTimestamp(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw * (raw > 1e12 ? 1 : 1000);
  if (typeof raw === "string") {
    const asNum = Number(raw);
    if (Number.isFinite(asNum)) return asNum * (asNum > 1e12 ? 1 : 1000);
  }
  return undefined;
}
