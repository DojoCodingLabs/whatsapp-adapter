// Polymorphic webhook event types — produced by `parseWebhookPayload` from
// Meta's `whatsapp_business_account` envelope. Discriminator: top-level
// `kind`. Every event carries `wabaId` (originating WABA) and a normalised
// epoch-ms `timestamp`.

import type { WhatsAppMessage } from "../messages/types.js";

export type WhatsAppEvent =
  | MessageEvent
  | StatusEvent
  | TemplateStatusEvent
  | TemplateQualityUpdateEvent
  | TemplateCategoryUpdateEvent
  | PhoneNumberQualityUpdateEvent
  | AccountAlertEvent
  | AccountReviewEvent
  | UnknownEvent;

export interface BaseEvent {
  /** WhatsApp Business Account id this event originated from. */
  wabaId: string;
  /** Phone number id when the event ties to a specific phone (messages, statuses, quality). */
  phoneNumberId?: string;
  /** E.164 display number when known. */
  displayPhoneNumber?: string;
  /** Event timestamp normalised to epoch milliseconds. */
  timestamp: number;
}

// ───────────── messages ─────────────

export type IncomingMessageKind =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | "interactive_button_reply"
  | "interactive_list_reply"
  | "button"
  | "order"
  | "reaction"
  | "system"
  | "unsupported";

export interface MessageEvent extends BaseEvent {
  kind: "message";
  /** wamid — Meta's unique message id. */
  id: string;
  from: string;
  type: IncomingMessageKind;
  /** The originating message wamid this is a reply to (when present). */
  contextId?: string;
  /**
   * Arbitrary type-specific body. Kept as the raw Meta object on purpose;
   * this lets consumers progressively narrow without locking the SDK to
   * every possible inbound shape. Outbound shapes are handled by
   * {@link WhatsAppMessage}.
   */
  body: Record<string, unknown>;
}

// ───────────── statuses ─────────────

/**
 * Documented status transitions Meta sends most often. The union widens
 * to `string` because Meta has shipped new transitions in the past
 * (e.g., `accepted`) without a major-version bump — typing this as a
 * literal-only union would force consumers to upgrade in lockstep.
 */
export type DeliveryStatus = "sent" | "delivered" | "read" | "failed" | (string & {});

export interface StatusEvent extends BaseEvent {
  kind: "status";
  /** wamid the status update applies to. */
  id: string;
  status: DeliveryStatus;
  /** Recipient WA id. */
  recipientId?: string;
  conversationId?: string;
  /** Pricing model ("CBP" vs "PMP" vs "regular") when Meta provides it. */
  pricingCategory?: string;
  /** Raw error envelope when status === "failed". */
  errors?: ReadonlyArray<{ code?: number; title?: string; message?: string }>;
}

// ───────────── template lifecycle ─────────────

export interface TemplateStatusEvent extends BaseEvent {
  kind: "template_status";
  templateId: string;
  templateName?: string;
  language?: string;
  /** APPROVED | REJECTED | DISABLED | PENDING | PAUSED | FLAGGED */
  event: string;
  reason?: string;
}

export interface TemplateQualityUpdateEvent extends BaseEvent {
  kind: "template_quality";
  templateId: string;
  templateName?: string;
  /** GREEN | YELLOW | RED */
  newQualityScore: string;
  previousQualityScore?: string;
}

export interface TemplateCategoryUpdateEvent extends BaseEvent {
  kind: "template_category";
  templateId: string;
  templateName?: string;
  newCategory: string;
  previousCategory?: string;
}

// ───────────── phone-number quality ─────────────

export interface PhoneNumberQualityUpdateEvent extends BaseEvent {
  kind: "phone_number_quality";
  /** GREEN | YELLOW | RED */
  newQualityScore: string;
}

// ───────────── account ─────────────

export interface AccountAlertEvent extends BaseEvent {
  kind: "account_alert";
  /** Severity / type Meta provides. */
  alertSeverity?: string;
  alertType?: string;
  raw: unknown;
}

export interface AccountReviewEvent extends BaseEvent {
  kind: "account_review";
  decision: string;
  raw: unknown;
}

// ───────────── unknown / future-proof ─────────────

export interface UnknownEvent extends BaseEvent {
  kind: "unknown";
  field: string;
  value: unknown;
}

// Re-export the outbound message type alias so consumers do not need to
// remember which barrel each lives under.
export type { WhatsAppMessage };
