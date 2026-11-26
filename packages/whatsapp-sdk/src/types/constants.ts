export const GRAPH_API_VERSION = "v26.0" as const;

export const META_GRAPH_BASE_URL = "https://graph.facebook.com" as const;

export const WEBHOOK_ACK_DEADLINE_MS = 30_000 as const;

export const WINDOW_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Default webhook dedupe TTL: 7 days. Meta retries a failed delivery
 * "with decreasing frequency ... for up to 7 days", so a shorter TTL
 * lets a late redelivery dispatch twice. Storage cost: one small key
 * per message / status transition for 7 days — size Redis / Postgres
 * accordingly, or pass a shorter `dedupeTtlMs` if your handlers are
 * idempotent.
 */
export const WEBHOOK_DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type GraphApiVersion = typeof GRAPH_API_VERSION | `v${number}.${number}`;

/**
 * Meta's documented hard character limits on free-form message fields.
 * The builders enforce these pre-flight so an over-long string fails
 * locally with `WhatsAppError("UNKNOWN")` instead of round-tripping to
 * Meta and coming back as code 100 / 131009. Counted in Unicode code
 * points (`[...s].length`), which is the lenient reading of "characters".
 *
 * Sources: Text / media / interactive message references under
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/
 * (text-messages, image-messages, document-messages,
 * interactive-reply-buttons-messages, interactive-list-messages,
 * interactive-cta-url-messages).
 */
export const MESSAGE_LENGTH_LIMITS = {
  /** `text.body` */
  textBody: 4096,
  /** `image` / `video` / `document` `caption` */
  mediaCaption: 1024,
  /** `interactive.body.text` for reply-button and cta_url messages */
  interactiveBody: 1024,
  /** `interactive.body.text` for list messages ("Maximum 4096 characters.") */
  listBody: 4096,
  /** `interactive.footer.text` */
  interactiveFooter: 60,
  /** `interactive.header.text` (type `text`) */
  interactiveHeaderText: 60,
  /** Reply button `reply.title` */
  replyButtonTitle: 20,
  /** Reply button `reply.id` */
  replyButtonId: 256,
  /** List `action.button` label */
  listButton: 20,
  /** List `sections[].title` */
  listSectionTitle: 24,
  /** List `rows[].title` */
  listRowTitle: 24,
  /** List `rows[].description` */
  listRowDescription: 72,
  /** List `rows[].id` */
  listRowId: 200,
  /** `cta_url` `parameters.display_text` */
  ctaUrlDisplayText: 20,
} as const;
