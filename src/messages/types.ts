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
  audio: Pick<MediaSource, "id" | "link">;
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
export type TemplateParameter =
  | TemplateParameterText
  | TemplateParameterCurrency
  | TemplateParameterDateTime
  | TemplateParameterImage
  | TemplateParameterVideo
  | TemplateParameterDocument;

export interface TemplateComponent {
  type: "header" | "body" | "button" | "footer";
  sub_type?: "quick_reply" | "url" | "copy_code";
  index?: string;
  parameters?: ReadonlyArray<TemplateParameter>;
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
