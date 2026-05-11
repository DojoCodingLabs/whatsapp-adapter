// Public TypeScript shapes for WhatsApp Cloud API send-able messages
// (Graph API v23). Keep these aligned with Meta's documented payloads.

export type RecipientType = "individual";

export interface BaseMessage {
  messaging_product: "whatsapp";
  recipient_type: RecipientType;
  to: string;
  context?: { message_id: string };
}

// ───────────── Text ─────────────

export interface TextBody {
  body: string;
  preview_url?: boolean;
}

export interface TextMessage extends BaseMessage {
  type: "text";
  text: TextBody;
}

// ───────────── Media (image / video / audio / document / sticker) ─────────────

export interface MediaSource {
  /** Pre-uploaded media id from `POST /{phone-number-id}/media`. */
  id?: string;
  /** Public URL Meta will fetch on send. */
  link?: string;
  /** Image / video / document caption. Not used for audio / sticker. */
  caption?: string;
  /** Document filename hint. Not used for image / video / audio / sticker. */
  filename?: string;
}

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

export interface ImageMessage extends BaseMessage {
  type: "image";
  image: Omit<MediaSource, "filename">;
}
export interface VideoMessage extends BaseMessage {
  type: "video";
  video: Omit<MediaSource, "filename">;
}
export interface AudioMessage extends BaseMessage {
  type: "audio";
  /**
   * Audio body. Setting `voice: true` makes the WhatsApp client render
   * the message as a push-to-talk voice note (with transcription
   * support, auto-download, and a "played" status when the recipient
   * listens) instead of a music file. Source:
   * https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages
   */
  audio: Pick<MediaSource, "id" | "link"> & { voice?: boolean };
}
export interface DocumentMessage extends BaseMessage {
  type: "document";
  document: MediaSource;
}
export interface StickerMessage extends BaseMessage {
  type: "sticker";
  sticker: Pick<MediaSource, "id" | "link">;
}

// ───────────── Location ─────────────

export interface LocationBody {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}
export interface LocationMessage extends BaseMessage {
  type: "location";
  location: LocationBody;
}

// ───────────── Contacts ─────────────

export interface ContactName {
  formatted_name: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  prefix?: string;
  suffix?: string;
}

export interface ContactPhone {
  phone: string;
  type?: "HOME" | "WORK" | "CELL" | "MAIN" | "IPHONE";
  wa_id?: string;
}

export interface ContactEmail {
  email: string;
  type?: "HOME" | "WORK";
}

export interface Contact {
  name: ContactName;
  phones?: ReadonlyArray<ContactPhone>;
  emails?: ReadonlyArray<ContactEmail>;
  org?: { company?: string; department?: string; title?: string };
  birthday?: string;
}

export interface ContactsMessage extends BaseMessage {
  type: "contacts";
  contacts: ReadonlyArray<Contact>;
}

// ───────────── Interactive (button / list / cta_url) ─────────────

export interface InteractiveHeaderText {
  type: "text";
  text: string;
}
export interface InteractiveHeaderImage {
  type: "image";
  image: { id?: string; link?: string };
}
export interface InteractiveHeaderVideo {
  type: "video";
  video: { id?: string; link?: string };
}
export interface InteractiveHeaderDocument {
  type: "document";
  document: { id?: string; link?: string; filename?: string };
}
export type InteractiveHeader =
  | InteractiveHeaderText
  | InteractiveHeaderImage
  | InteractiveHeaderVideo
  | InteractiveHeaderDocument;

export interface InteractiveButtonReply {
  type: "reply";
  reply: { id: string; title: string };
}

export interface InteractiveButtonAction {
  buttons: ReadonlyArray<InteractiveButtonReply>;
}

export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveListSection {
  title: string;
  rows: ReadonlyArray<InteractiveListRow>;
}

export interface InteractiveListAction {
  button: string;
  sections: ReadonlyArray<InteractiveListSection>;
}

export interface InteractiveCtaUrlAction {
  name: "cta_url";
  parameters: { display_text: string; url: string };
}

export interface InteractiveButtonBody {
  type: "button";
  header?: InteractiveHeader;
  body: { text: string };
  footer?: { text: string };
  action: InteractiveButtonAction;
}

export interface InteractiveListBody {
  type: "list";
  header?: InteractiveHeaderText;
  body: { text: string };
  footer?: { text: string };
  action: InteractiveListAction;
}

export interface InteractiveCtaUrlBody {
  type: "cta_url";
  header?: InteractiveHeader;
  body: { text: string };
  footer?: { text: string };
  action: InteractiveCtaUrlAction;
}

export type InteractiveBody = InteractiveButtonBody | InteractiveListBody | InteractiveCtaUrlBody;

export interface InteractiveMessage extends BaseMessage {
  type: "interactive";
  interactive: InteractiveBody;
}

// ───────────── Template ─────────────

export interface TemplateLanguage {
  code: string;
  policy?: "deterministic";
}

export interface TemplateParameterText {
  type: "text";
  text: string;
}
export interface TemplateParameterCurrency {
  type: "currency";
  currency: { fallback_value: string; code: string; amount_1000: number };
}
export interface TemplateParameterDateTime {
  type: "date_time";
  date_time: { fallback_value: string };
}
export interface TemplateParameterImage {
  type: "image";
  image: { id?: string; link?: string };
}
export interface TemplateParameterVideo {
  type: "video";
  video: { id?: string; link?: string };
}
export interface TemplateParameterDocument {
  type: "document";
  document: { id?: string; link?: string; filename?: string };
}
/**
 * Limited-time-offer parameter (paired with a `type: "limited_time_offer"`
 * component). `expiration_time_ms` is Unix epoch milliseconds. Source:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/limited-time-offer-templates/
 */
export interface TemplateParameterLimitedTimeOffer {
  type: "limited_time_offer";
  limited_time_offer: { expiration_time_ms: number };
}
/**
 * Coupon-code parameter (paired with a `sub_type: "copy_code"` button).
 * Source: same Meta doc as `TemplateParameterLimitedTimeOffer`.
 */
export interface TemplateParameterCouponCode {
  type: "coupon_code";
  coupon_code: string;
}
/**
 * Payload parameter for `sub_type: "quick_reply"` buttons (used inside
 * carousel cards). Source:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates/
 */
export interface TemplateParameterPayload {
  type: "payload";
  payload: string;
}
export type TemplateParameter =
  | TemplateParameterText
  | TemplateParameterCurrency
  | TemplateParameterDateTime
  | TemplateParameterImage
  | TemplateParameterVideo
  | TemplateParameterDocument
  | TemplateParameterLimitedTimeOffer
  | TemplateParameterCouponCode
  | TemplateParameterPayload;

/**
 * A single carousel card. The `card_index` is 0-based and assigned by
 * the builder, never by the caller. Per Meta's docs the card's
 * `components` array contains a required `header` plus optional
 * `body` and `button` sub-components.
 */
export interface CarouselCardComponent {
  card_index: number;
  components: ReadonlyArray<TemplateComponent>;
}

export interface TemplateComponent {
  type: "header" | "body" | "button" | "footer" | "carousel" | "limited_time_offer";
  sub_type?: "quick_reply" | "url" | "copy_code";
  /**
   * Meta's docs use a string for auth-template buttons (`"0"`) and a
   * number for carousel-card buttons (`0`). Both work at the API; we
   * mirror what Meta publishes so reviewers can diff without mental
   * conversion.
   */
  index?: string | number;
  parameters?: ReadonlyArray<TemplateParameter>;
  /** Only set when `type === "carousel"`. */
  cards?: ReadonlyArray<CarouselCardComponent>;
}

export interface TemplateBody {
  name: string;
  language: TemplateLanguage;
  components?: ReadonlyArray<TemplateComponent>;
}

export interface TemplateMessage extends BaseMessage {
  type: "template";
  template: TemplateBody;
}

// ───────────── Reaction ─────────────

export interface ReactionBody {
  message_id: string;
  emoji: string;
}

export interface ReactionMessage extends BaseMessage {
  type: "reaction";
  reaction: ReactionBody;
}

// ───────────── Discriminated union & response ─────────────

export type WhatsAppMessage =
  | TextMessage
  | ImageMessage
  | VideoMessage
  | AudioMessage
  | DocumentMessage
  | StickerMessage
  | LocationMessage
  | ContactsMessage
  | InteractiveMessage
  | TemplateMessage
  | ReactionMessage;

export interface MessageSendResponseContact {
  input: string;
  wa_id: string;
}

export interface MessageSendResponseMessage {
  id: string;
  message_status?: string;
}

export interface MessageSendResponse {
  messaging_product: "whatsapp";
  contacts: ReadonlyArray<MessageSendResponseContact>;
  messages: ReadonlyArray<MessageSendResponseMessage>;
}
