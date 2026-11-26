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
  UserPreferencesEvent,
  WebhookContact,
  WebhookErrorDetail,
  WebhookErrorEvent,
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
  "request_welcome",
  "unsupported",
  "interactive",
  "edit",
  "revoke",
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
    case "user_preferences":
      return parseUserPreferences(value, {
        wabaId,
        phoneNumberId,
        displayPhoneNumber,
        baseTimestamp,
      });
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
  const contacts = readContacts(value);
  const messages = Array.isArray(value["messages"])
    ? (value["messages"] as Array<Record<string, unknown>>)
    : [];
  for (const m of messages) {
    if (m === null || typeof m !== "object") continue;
    out.push(parseInboundMessage(m, ctx, contacts, messages.length === 1));
  }
  const statuses = Array.isArray(value["statuses"])
    ? (value["statuses"] as Array<Record<string, unknown>>)
    : [];
  for (const s of statuses) {
    if (s === null || typeof s !== "object") continue;
    out.push(parseStatus(s, ctx, contacts, statuses.length === 1));
  }
  // System-, app- and account-level errors arrive as `value.errors`,
  // often with no messages / statuses at all. Surface them instead of
  // returning zero events.
  const errors = readErrors(value["errors"]);
  if (errors !== undefined) {
    const ev: WebhookErrorEvent = {
      kind: "webhook_error",
      wabaId: ctx.wabaId,
      timestamp: ctx.baseTimestamp,
      field: "messages",
      errors,
    };
    if (ctx.phoneNumberId !== undefined) ev.phoneNumberId = ctx.phoneNumberId;
    if (ctx.displayPhoneNumber !== undefined) ev.displayPhoneNumber = ctx.displayPhoneNumber;
    out.push(ev);
  }
  return out;
}

/** Non-empty array of error objects, or undefined. Objects pass through verbatim. */
function readErrors(raw: unknown): ReadonlyArray<WebhookErrorDetail> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const errors = raw.filter((e): e is WebhookErrorDetail => e !== null && typeof e === "object");
  return errors.length > 0 ? errors : undefined;
}

function readContacts(value: Record<string, unknown>): ReadonlyArray<Record<string, unknown>> {
  const raw = value["contacts"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is Record<string, unknown> => c !== null && typeof c === "object");
}

/**
 * Join a `value.contacts[]` entry: `wa_id === waId`, else
 * `user_id === userId`, else (only when the batch holds a single
 * message / status) the single contact when there is exactly one.
 * Never guesses between several unmatched contacts.
 */
function matchContact(
  contacts: ReadonlyArray<Record<string, unknown>>,
  waId: string | undefined,
  userId: string | undefined,
  allowSingleFallback: boolean
): Record<string, unknown> | undefined {
  if (contacts.length === 0) return undefined;
  if (waId !== undefined && waId !== "") {
    const byWa = contacts.find((c) => c["wa_id"] === waId);
    if (byWa !== undefined) return byWa;
  }
  if (userId !== undefined && userId !== "") {
    const byUser = contacts.find((c) => c["user_id"] === userId);
    if (byUser !== undefined) return byUser;
  }
  return allowSingleFallback && contacts.length === 1 ? contacts[0] : undefined;
}

function toWebhookContact(c: Record<string, unknown>): WebhookContact {
  const out: WebhookContact = {};
  const waId = pickString(c, "wa_id");
  if (waId !== undefined) out.waId = waId;
  const userId = pickString(c, "user_id");
  if (userId !== undefined) out.userId = userId;
  const parentUserId = pickString(c, "parent_user_id");
  if (parentUserId !== undefined) out.parentUserId = parentUserId;
  const profile = c["profile"];
  if (profile !== null && typeof profile === "object") {
    const p = profile as Record<string, unknown>;
    const username = pickString(p, "username");
    if (username !== undefined) out.username = username;
    const name = pickString(p, "name");
    if (name !== undefined) out.profileName = name;
  }
  const identityKeyHash = pickString(c, "identity_key_hash");
  if (identityKeyHash !== undefined) out.identityKeyHash = identityKeyHash;
  return out;
}

function parseInboundMessage(
  m: Record<string, unknown>,
  ctx: ParseCtx,
  contacts: ReadonlyArray<Record<string, unknown>>,
  allowSingleFallback: boolean
): MessageEvent {
  const id = typeof m["id"] === "string" ? m["id"] : "";
  // `from` is omitted for username users without a shareable phone
  // number and for system `user_changed_user_id`. Kept as `""` for
  // backward compatibility; `fromUserId` / `messageSenderKey` carry the
  // identity in that case.
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

  const rawContact = matchContact(
    contacts,
    from,
    pickString(m, "from_user_id"),
    allowSingleFallback
  );
  const contact = rawContact !== undefined ? toWebhookContact(rawContact) : undefined;
  let fromUserId = pickString(m, "from_user_id") ?? contact?.userId;
  if (fromUserId === undefined && rawType === "system") {
    const system = m["system"];
    if (system !== null && typeof system === "object") {
      const sys = system as Record<string, unknown>;
      if (sys["type"] === "user_changed_user_id") fromUserId = pickString(sys, "user_id");
    }
  }
  if (fromUserId !== undefined) ev.fromUserId = fromUserId;
  const fromParentUserId = pickString(m, "from_parent_user_id");
  if (fromParentUserId !== undefined) ev.fromParentUserId = fromParentUserId;
  if (contact !== undefined) ev.contact = contact;
  const groupId = pickString(m, "group_id");
  if (groupId !== undefined) ev.groupId = groupId;
  const errors = readErrors(m["errors"]);
  if (errors !== undefined) ev.errors = errors;

  // CTWA / referral payload — preserved verbatim from `messages[i].referral`
  // when present. Typed core fields narrow at the TS level; unknown
  // future fields Meta adds pass through at runtime (permissive
  // intersection type on `MessageEvent.referral`). Empty `{}` is
  // preserved — distinguishes "no referral" from "referral present
  // but Meta omitted details".
  if (typeof m["referral"] === "object" && m["referral"] !== null) {
    ev.referral = m["referral"] as NonNullable<MessageEvent["referral"]>;
  }
  return ev;
}

function normaliseIncomingType(rawType: string, m: Record<string, unknown>): IncomingMessageKind {
  if (rawType === "interactive") {
    const interactive = m["interactive"] as Record<string, unknown> | undefined;
    const subType =
      interactive && typeof interactive["type"] === "string" ? interactive["type"] : undefined;
    if (subType === "button_reply") return "interactive_button_reply";
    if (subType === "list_reply") return "interactive_list_reply";
    if (subType === "nfm_reply") return "interactive_nfm_reply";
    if (subType === "product") return "interactive_product";
    return "unsupported";
  }
  if (KNOWN_INCOMING_KINDS.has(rawType)) {
    return rawType as IncomingMessageKind;
  }
  return "unsupported";
}

/**
 * `user_preferences` field: one event per `user_preferences[i]` entry.
 * `wa_id` lives on the entry itself; when Meta omits it we fall back to
 * `contacts[0].wa_id`, which the envelope also carries. `wa_id` is
 * omitted entirely for username users without a shareable phone; then
 * `waId` is `""` and `userId` (BSUID) identifies the user.
 */
function parseUserPreferences(
  value: Record<string, unknown>,
  ctx: ParseCtx
): ReadonlyArray<WhatsAppEvent> {
  const entries = Array.isArray(value["user_preferences"])
    ? (value["user_preferences"] as Array<Record<string, unknown>>)
    : [];
  const contacts = Array.isArray(value["contacts"])
    ? (value["contacts"] as Array<Record<string, unknown>>)
    : [];
  const contactWaId =
    contacts[0] !== undefined && typeof contacts[0]["wa_id"] === "string"
      ? contacts[0]["wa_id"]
      : undefined;
  // BSUID fallback only when the envelope names exactly one contact.
  const contactUserId =
    contacts.length === 1 && contacts[0] !== undefined && typeof contacts[0]["user_id"] === "string"
      ? contacts[0]["user_id"]
      : undefined;

  const out: WhatsAppEvent[] = [];
  for (const p of entries) {
    if (p === null || typeof p !== "object") continue;
    const waId = typeof p["wa_id"] === "string" ? p["wa_id"] : (contactWaId ?? "");
    const ev: UserPreferencesEvent = {
      kind: "user_preferences",
      wabaId: ctx.wabaId,
      timestamp: parseTimestamp(p["timestamp"]) ?? ctx.baseTimestamp,
      waId,
      category: typeof p["category"] === "string" ? p["category"] : "marketing_messages",
      value: typeof p["value"] === "string" ? p["value"] : "",
      raw: p,
    };
    if (ctx.phoneNumberId !== undefined) ev.phoneNumberId = ctx.phoneNumberId;
    if (ctx.displayPhoneNumber !== undefined) ev.displayPhoneNumber = ctx.displayPhoneNumber;
    if (typeof p["detail"] === "string") ev.detail = p["detail"];
    const userId = pickString(p, "user_id") ?? contactUserId;
    if (userId !== undefined) ev.userId = userId;
    const parentUserId = pickString(p, "parent_user_id");
    if (parentUserId !== undefined) ev.parentUserId = parentUserId;
    out.push(ev);
  }
  return out;
}

function parseStatus(
  s: Record<string, unknown>,
  ctx: ParseCtx,
  contacts: ReadonlyArray<Record<string, unknown>>,
  allowSingleFallback: boolean
): StatusEvent {
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
  const pricingType = pricing && typeof pricing["type"] === "string" ? pricing["type"] : undefined;
  const pricingModel =
    pricing && typeof pricing["pricing_model"] === "string" ? pricing["pricing_model"] : undefined;
  const billable =
    pricing && typeof pricing["billable"] === "boolean" ? pricing["billable"] : undefined;
  const pricingSubtype =
    pricing && typeof pricing["subtype"] === "string" ? pricing["subtype"] : undefined;
  const errors = Array.isArray(s["errors"])
    ? (s["errors"] as NonNullable<StatusEvent["errors"]>)
    : undefined;
  const recipientUserId = pickString(s, "recipient_user_id");

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
  if (pricingType !== undefined) ev.pricingType = pricingType;
  if (pricingModel !== undefined) ev.pricingModel = pricingModel;
  if (pricingSubtype !== undefined) ev.pricingSubtype = pricingSubtype;
  if (billable !== undefined) ev.billable = billable;
  if (recipientUserId !== undefined) ev.recipientUserId = recipientUserId;
  const optional = [
    ["recipient_parent_user_id", "recipientParentUserId"],
    ["recipient_type", "recipientType"],
    ["recipient_participant_id", "recipientParticipantId"],
    ["recipient_identity_key_hash", "recipientIdentityKeyHash"],
    ["biz_opaque_callback_data", "bizOpaqueCallbackData"],
  ] as const;
  for (const [src, dst] of optional) {
    const v = pickString(s, src);
    if (v !== undefined) ev[dst] = v;
  }
  const rawContact = matchContact(contacts, recipientId, recipientUserId, allowSingleFallback);
  if (rawContact !== undefined) ev.contact = toWebhookContact(rawContact);
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
