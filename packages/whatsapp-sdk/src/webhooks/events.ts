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
  | WebhookErrorEvent
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
  /**
   * Single-product message a user sends from the business's catalog
   * (`interactive.type === "product"`); details at
   * `body.interactive.product` (`retailer_id`, `title`, `price_amount`, …).
   */
  | "interactive_product"
  /** Template quick-reply tap (`button: { payload, text }`). */
  | "button"
  | "order"
  | "reaction"
  | "system"
  /**
   * Coexistence only (WhatsApp Business app numbers): the user edited
   * an earlier message. `body.edit.original_message_id` + `body.edit.message`.
   */
  | "edit"
  /**
   * Coexistence only: the user deleted ("revoked") an earlier message.
   * `body.revoke.original_message_id`.
   */
  | "revoke"
  /**
   * @deprecated Meta removed the `request_welcome` webhook and the
   * welcome-message conversational component on 2026-03-27 ("This
   * feature is no longer supported"). The SDK still classifies the type
   * so historical / replayed payloads do not collapse to `"unsupported"`,
   * but new integrations should not expect to receive it.
   */
  | "request_welcome"
  | "unsupported";

/**
 * Error object Meta attaches to `value.errors[]`, `messages[].errors[]`
 * (with `type: "unsupported"`) and `statuses[].errors[]`. Runtime objects
 * are passed through verbatim, so undocumented keys survive.
 */
export interface WebhookErrorDetail {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
  /** Link to Meta's error-code reference. */
  href?: string;
}

/**
 * Identity block joined from `value.contacts[]`. Every field is optional:
 * `waId` is omitted for users who adopted a username and do not share
 * their phone number; `username` only appears when the user has one;
 * `identityKeyHash` only when the identity-change check is enabled.
 */
export interface WebhookContact {
  /** `contacts[].wa_id` — phone-number WhatsApp id (when shareable). */
  waId?: string;
  /** `contacts[].user_id` — business-scoped user id (BSUID). */
  userId?: string;
  /** `contacts[].parent_user_id` — parent BSUID (when enabled). */
  parentUserId?: string;
  /** `contacts[].profile.username`. */
  username?: string;
  /** `contacts[].profile.name`. */
  profileName?: string;
  /** `contacts[].identity_key_hash` (identity-change check). */
  identityKeyHash?: string;
}

/**
 * Click-to-WhatsApp (CTWA) referral payload Meta attaches to the
 * first inbound message a user sends after clicking an ad. The
 * documented core fields are typed here; unknown additional fields
 * Meta may introduce in the future are preserved at runtime via the
 * intersection with `Record<string, unknown>` on `MessageEvent.referral`.
 *
 * See Meta's webhook payload reference for the up-to-date list of
 * fields; the canonical attribution field for Meta CAPI is
 * `ctwa_clid`. `ctwa_clid` is omitted entirely for messages that
 * originate from an ad in WhatsApp Status. Use `messageReferral(e)`
 * for a normalised camelCase view.
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
  /** Media type of the ad ("image" | "video"). */
  media_type?: string;
  /** URL of the ad's image (when `media_type === "image"`). */
  image_url?: string;
  /** URL of the ad's video (when `media_type === "video"`). */
  video_url?: string;
  /** URL of the video thumbnail (video only). */
  thumbnail_url?: string;
  /**
   * @deprecated Not in Meta's current referral reference (which uses
   * `image_url` / `video_url`); kept so older payloads still type-check.
   */
  media_url?: string;
  /**
   * Prefilled welcome message configured on the ad. Current docs ship
   * `{ text }`; `message_id` is kept as a deprecated legacy key.
   */
  welcome_message?: {
    text?: string;
    /** @deprecated Not in Meta's current referral reference. */
    message_id?: string;
  };
}

export interface MessageEvent extends BaseEvent {
  kind: "message";
  /** wamid — Meta's unique message id. Dedupe keys on this. */
  id: string;
  /**
   * `messages[].from` — the sender's phone-number WhatsApp id.
   *
   * **May be `""`.** Since the BSUID rollout Meta omits `from` when the
   * user adopted a username and their phone number cannot be shared,
   * and on `system` `user_changed_user_id` messages. Never key state on
   * `from` alone: use {@link messageSenderKey} (phone when present,
   * otherwise the BSUID) or {@link MessageEvent.fromUserId}.
   */
  from: string;
  /**
   * `messages[].from_user_id` — business-scoped user id (BSUID), e.g.
   * `"US.13491208655302741918"`. Falls back to the joined
   * `contact.userId`, and for `system` `user_changed_user_id` to the
   * new `system.user_id`. Absent on legacy payloads.
   */
  fromUserId?: string;
  /** `messages[].from_parent_user_id` — only when parent BSUIDs are enabled. */
  fromParentUserId?: string;
  /**
   * The `value.contacts[]` entry for this sender, matched by
   * `wa_id === from`, else `user_id === fromUserId`, else — only in a
   * single-message batch — the one contact when there is exactly one.
   * Absent when no contact matches (system messages carry no contacts).
   */
  contact?: WebhookContact;
  /** `messages[].group_id` — present when the message belongs to a group. */
  groupId?: string;
  /** `messages[].errors` — set on `type: "unsupported"` messages. */
  errors?: ReadonlyArray<WebhookErrorDetail>;
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
   * `ctwa_clid` themselves keyed on `messageSenderKey(e)`.
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
  /**
   * `recipient_id` — recipient phone-number WA id. Omitted when the
   * message was sent to a BSUID and the phone number is unavailable.
   */
  recipientId?: string;
  /**
   * `recipient_user_id` — recipient BSUID. Meta omits it on `failed`
   * statuses for messages sent to a phone number.
   */
  recipientUserId?: string;
  /** `recipient_parent_user_id` — when parent BSUIDs are enabled. */
  recipientParentUserId?: string;
  /** `recipient_type` — e.g. `"group"` for group sends. */
  recipientType?: string;
  /** `recipient_participant_id` — group participant (group sends). */
  recipientParticipantId?: string;
  /** `recipient_identity_key_hash` — identity-change check. */
  recipientIdentityKeyHash?: string;
  /**
   * `biz_opaque_callback_data` you attached on send — echo it back to
   * correlate statuses with your own records.
   */
  bizOpaqueCallbackData?: string;
  /**
   * Status-side `value.contacts[]` entry, matched like
   * {@link MessageEvent.contact} (by `recipient_id`, then
   * `recipient_user_id`, then the one contact of a single-status batch).
   * Meta sends contacts only
   * on sent / delivered / read (never on failed) and omits `username`
   * on `sent`.
   */
  contact?: WebhookContact;
  /**
   * `conversation.id` when Meta includes the `conversation` object.
   * Since Graph API v24.0 Meta omits `conversation` on most statuses
   * (per-message pricing); it is still present for messages sent inside
   * a free entry-point window. Treat as usually absent.
   */
  conversationId?: string;
  /**
   * `pricing.category` — the billing category of the message, e.g.
   * `utility` | `marketing` | `marketing_lite` | `authentication` |
   * `authentication-international` | `service` | `referral_conversion` |
   * `group_marketing` | `group_service` | `group_utility`. Open string.
   *
   * Meta includes the `pricing` object on the `sent` status **and** on
   * one of `delivered` / `read` (only one of those two), so do not
   * assume it only arrives on `sent`.
   */
  pricingCategory?: string;
  /**
   * `pricing.type` — how this message was charged: `regular` (billed),
   * `free_customer_service` (as of Oct 1, 2026: a free 1:1 service
   * delivery, e.g. inside the phone number's free tier),
   * `free_group_customer_service` (group equivalent) or
   * `free_entry_point` (72 h CTWA / free entry-point window). Open
   * string; reconcile invoices against this plus {@link pricingSubtype}.
   */
  pricingType?: string;
  /**
   * `pricing.subtype` — only on free service messages: `free_tier` or
   * `paid_exempt` (added Oct / Nov 2026). Open string.
   */
  pricingSubtype?: string;
  /**
   * `pricing.pricing_model` — `PMP` (per-message pricing, current) or
   * `CBP` (legacy conversation-based pricing).
   */
  pricingModel?: string;
  /**
   * `pricing.billable` — whether Meta counts this message towards the
   * invoice. Meta flags it for deprecation in a future versioned
   * release; prefer `pricingType` + `pricingCategory`.
   */
  billable?: boolean;
  /** Raw error envelope when status === "failed" (passed through verbatim). */
  errors?: ReadonlyArray<WebhookErrorDetail>;
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
  /**
   * The customer's phone-number WhatsApp id. **May be `""`**: Meta omits
   * `wa_id` when the user adopted a username and their phone number
   * cannot be shared (falls back to `contacts[0].wa_id` first). Key
   * opt-outs on `userId` in that case.
   */
  waId: string;
  /** `user_preferences[].user_id` — the user's BSUID (falls back to the single contact's `user_id`). */
  userId?: string;
  /** `user_preferences[].parent_user_id` — informational; preferences never apply at parent level. */
  parentUserId?: string;
  /** Preference category. Meta ships `"marketing_messages"` today; widened for forward-compat. */
  category: "marketing_messages" | (string & {});
  /** `"stop"` — opted out; `"resume"` — opted back in. Widened for forward-compat. */
  value: "stop" | "resume" | (string & {});
  /** Meta's human-readable description of the change. */
  detail?: string;
  /** Raw `user_preferences[i]` entry, for fields the SDK does not type. */
  raw: Record<string, unknown>;
}

// ───────────── value-level errors ─────────────

/**
 * System-, app- or account-level errors Meta attaches as
 * `entry[].changes[].value.errors` (a change that may carry no
 * messages or statuses at all). One event per change.
 */
export interface WebhookErrorEvent extends BaseEvent {
  kind: "webhook_error";
  /** The change `field` the errors arrived on (usually `"messages"`). */
  field: string;
  errors: ReadonlyArray<WebhookErrorDetail>;
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
