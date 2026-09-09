export const GRAPH_API_VERSION = "v25.0" as const;

export const META_GRAPH_BASE_URL = "https://graph.facebook.com" as const;

export const WEBHOOK_ACK_DEADLINE_MS = 30_000 as const;

export const WINDOW_TTL_MS = 24 * 60 * 60 * 1000;

export const WEBHOOK_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

export type GraphApiVersion = typeof GRAPH_API_VERSION | `v${number}.${number}`;

/**
 * Meta's documented hard character limits on free-form message fields.
 * The builders enforce these pre-flight so an over-long string fails
 * locally with `WhatsAppError("UNKNOWN")` instead of round-tripping to
 * Meta and coming back as code 100 / 131009. Counted in Unicode code
 * points (`[...s].length`), which is the lenient reading of "characters".
 *
 * Sources: Text / media / interactive message references under
 * https://developers.facebook.com/docs/whatsapp/cloud-api/messages
 */
export const MESSAGE_LENGTH_LIMITS = {
  /** `text.body` */
  textBody: 4096,
  /** `image` / `video` / `document` `caption` */
  mediaCaption: 1024,
  /** `interactive.body.text` (button, list, cta_url) */
  interactiveBody: 1024,
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
