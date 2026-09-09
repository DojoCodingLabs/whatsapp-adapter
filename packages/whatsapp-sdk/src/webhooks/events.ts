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
  | UserPreferencesEvent
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
  /**
   * WhatsApp Flows completion (`interactive.type === "nfm_reply"`).
   * The submitted data is `body.interactive.nfm_reply.response_json`
   * — a JSON **string** you parse yourself.
   */
  | "interactive_nfm_reply"
  | "button"
  | "order"
  | "reaction"
  | "system"
  /**
   * Sent when a user opens a Click-to-WhatsApp conversation before
   * typing anything — the trigger for a welcome message inside the
   * 72 h free entry-point window. Carries no user content.
   */
  | "request_welcome"
  | "unsupported";

/**
 * Click-to-WhatsApp (CTWA) referral payload Meta attaches to the
 * first inbound message a user sends after clicking an ad. The
 * documented core fields are typed here; unknown additional fields
 * Meta may introduce in the future are preserved at runtime via the
 * intersection with `Record<string, unknown>` on `MessageEvent.referral`.
 *
 * See Meta's webhook payload reference for the up-to-date list of
 * fields; the canonical attribution field for Meta CAPI is
 * `ctwa_clid`.
 */
export interface WhatsAppReferral {
  /** Click-to-WhatsApp click ID used by Meta CAPI for attribution. */
  ctwa_clid?: string;
  /** Source URL the user came from (ad / post link). */
  source_url?: string;
  /** "ad" | "post" — the source type. */
  source_type?: string;
  /** Meta-side source identifier (ad ID, post ID, etc.). */
  source_id?: string;
  /** Headline shown above the ad. */
  headline?: string;
  /** Body text of the ad/post. */
  body?: string;
  /** Media type of the ad ("image" | "video" | "text"). */
  media_type?: string;
  /** URL of the ad's media asset (image or video). */
  media_url?: string;
  /** URL of the thumbnail (video only). */
  thumbnail_url?: string;
  /** Welcome message id set on the ad (when present). */
  welcome_message?: { message_id?: string };
}

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
  /**
   * Click-to-WhatsApp / referral payload Meta attaches to the **first**
   * inbound message a user sends after clicking a CTWA ad. Subsequent
   * messages in the same conversation do not carry it; consumers
   * tracking attribution across a multi-turn flow cache the
   * `ctwa_clid` themselves keyed on `from`.
   *
   * Typed as an intersection with `Record<string, unknown>` so future
   * fields Meta adds (not yet named in {@link WhatsAppReferral}) are
   * preserved at runtime without an SDK release. The TypeScript type
   * narrows the documented core fields; the runtime object may carry
   * more.
   *
   * When `messages[i].referral` is absent in the payload, this field
   * is `undefined`. When Meta sends an empty object (`{}`), this field
   * is `{}` — preserved verbatim so consumers can distinguish "no
   * referral" from "referral present but Meta omitted details".
   */
  referral?: WhatsAppReferral & Record<string, unknown>;
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
  /**
   * `conversation.id` when Meta includes the `conversation` object.
   * Since Graph API v24.0 Meta omits `conversation` on most statuses
   * (per-message pricing); it is still present for messages sent inside
   * a free entry-point window. Treat as usually absent.
   */
  conversationId?: string;
  /**
   * `pricing.category` — the billing category of the message:
   * `utility` | `marketing` | `authentication` | `authentication-international`
   * | `service` | `referral_conversion`. Present on the first billable
   * status (`sent`) when Meta provides it.
   */
  pricingCategory?: string;
  /**
   * `pricing.type` — how this message was charged:
   * `regular` (billed per message), `free_customer_service` (free-form
   * inside the 24 h window, free until Oct 1, 2026) or
   * `free_entry_point` (inside the 72 h CTWA / free entry-point window).
   * Financially material from Oct 1, 2026 when `free_customer_service`
   * stops being free; use it to reconcile invoices.
   */
  pricingType?: string;
  /**
   * `pricing.pricing_model` — `PMP` (per-message pricing, current) or
   * `CBP` (legacy conversation-based pricing).
   */
  pricingModel?: string;
  /** `pricing.billable` — whether Meta counts this message towards the invoice. */
  billable?: boolean;
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

// ───────────── user preferences (marketing opt-out) ─────────────

/**
 * Meta's authoritative marketing opt-out / opt-in signal (`user_preferences`
 * webhook field, Nov 2024). One event per entry in the payload's
 * `user_preferences[]` array.
 *
 * Wire it to your `OptInRegistry` so MARKETING template sends are
 * pre-flighted client-side instead of failing at Meta with `131050`:
 *
 *   receiver.on("user_preferences", (e) =>
 *     e.value === "stop"
 *       ? registry.optOut(e.waId, { category: "MARKETING" })
 *       : registry.optIn(e.waId, { category: "MARKETING", source: "user_preferences" })
 *   );
 */
export interface UserPreferencesEvent extends BaseEvent {
  kind: "user_preferences";
  /** The customer's WhatsApp id (what you send `to`). */
  waId: string;
  /** Preference category. Meta ships `"marketing_messages"` today; widened for forward-compat. */
  category: "marketing_messages" | (string & {});
  /** `"stop"` — opted out; `"resume"` — opted back in. Widened for forward-compat. */
  value: "stop" | "resume" | (string & {});
  /** Meta's human-readable description of the change. */
  detail?: string;
  /** Raw `user_preferences[i]` entry, for fields the SDK does not type. */
  raw: Record<string, unknown>;
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
