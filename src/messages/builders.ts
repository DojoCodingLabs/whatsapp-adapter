import type { TemplateDefinition } from "../templates/types.js";
import { validateTemplateSend } from "../templates/validate.js";
import { TemplateError, WhatsAppError } from "../types/errors.js";

import type {
  AudioMessage,
  CarouselCardComponent,
  Contact,
  ContactsMessage,
  DocumentMessage,
  ImageMessage,
  InteractiveButtonBody,
  InteractiveCtaUrlBody,
  InteractiveHeader,
  InteractiveListBody,
  InteractiveListSection,
  InteractiveMessage,
  LocationMessage,
  ReactionMessage,
  StickerMessage,
  TemplateBody,
  TemplateComponent,
  TemplateMessage,
  TemplateParameter,
  TextMessage,
  VideoMessage,
  WhatsAppMessage,
} from "./types.js";

const BASE_PAYLOAD = {
  messaging_product: "whatsapp",
  recipient_type: "individual",
} as const;

function fail(message: string, cause?: unknown): never {
  throw new WhatsAppError("UNKNOWN", message, cause === undefined ? undefined : { cause });
}

function failTemplate(message: string, templateName?: string, cause?: unknown): never {
  throw new TemplateError(message, templateName, cause === undefined ? undefined : { cause });
}

function ensureRecipient(to: unknown): string {
  if (typeof to !== "string" || to.trim().length === 0) {
    fail("Invalid recipient: `to` must be a non-empty string.");
  }
  return to;
}

function ensureReplyTo(replyTo: string | undefined): string | undefined {
  if (replyTo === undefined) return undefined;
  if (typeof replyTo !== "string" || replyTo.length === 0) {
    fail("Invalid `replyTo`: must be a non-empty wamid string.");
  }
  return replyTo;
}

function withReplyTo<T extends WhatsAppMessage>(payload: T, replyTo: string | undefined): T {
  if (replyTo === undefined) return payload;
  return { ...payload, context: { message_id: replyTo } };
}

function exactlyOne(a: unknown, b: unknown, label: string): void {
  const haveA = typeof a === "string" && a.length > 0;
  const haveB = typeof b === "string" && b.length > 0;
  if (haveA === haveB) {
    fail(`${label}: provide exactly one of \`id\` or \`link\` (not both, not neither).`);
  }
}

function ensureNumberInRange(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label}: must be a finite number in [${min}, ${max}].`);
  }
  return value;
}

// ───────────── Text ─────────────

export interface BuildTextInput {
  to: string;
  body: string;
  previewUrl?: boolean;
  replyTo?: string;
}

export function buildText(input: BuildTextInput): TextMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  if (typeof input.body !== "string" || input.body.length === 0) {
    fail("buildText: `body` must be a non-empty string.");
  }
  const text: TextMessage["text"] =
    input.previewUrl === undefined
      ? { body: input.body }
      : { body: input.body, preview_url: input.previewUrl };
  return withReplyTo({ ...BASE_PAYLOAD, to, type: "text", text }, replyTo);
}

// ───────────── Media ─────────────

export interface BuildMediaInput {
  to: string;
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
  replyTo?: string;
}

function mediaSource(
  input: BuildMediaInput,
  label: string
): {
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
} {
  exactlyOne(input.id, input.link, label);
  const out: { id?: string; link?: string; caption?: string; filename?: string } = {};
  if (typeof input.id === "string" && input.id.length > 0) out.id = input.id;
  if (typeof input.link === "string" && input.link.length > 0) out.link = input.link;
  if (input.caption !== undefined) out.caption = input.caption;
  if (input.filename !== undefined) out.filename = input.filename;
  return out;
}

export function buildImage(input: BuildMediaInput): ImageMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  const src = mediaSource(input, "buildImage");
  delete src.filename;
  return withReplyTo({ ...BASE_PAYLOAD, to, type: "image", image: src }, replyTo);
}

export function buildVideo(input: BuildMediaInput): VideoMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  const src = mediaSource(input, "buildVideo");
  delete src.filename;
  return withReplyTo({ ...BASE_PAYLOAD, to, type: "video", video: src }, replyTo);
}

export function buildAudio(input: BuildMediaInput): AudioMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  const src = mediaSource(input, "buildAudio");
  return withReplyTo(
    {
      ...BASE_PAYLOAD,
      to,
      type: "audio",
      audio: src.id !== undefined ? { id: src.id } : { link: src.link! },
    },
    replyTo
  );
}

export function buildDocument(input: BuildMediaInput): DocumentMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  const src = mediaSource(input, "buildDocument");
  return withReplyTo({ ...BASE_PAYLOAD, to, type: "document", document: src }, replyTo);
}

export function buildSticker(input: BuildMediaInput): StickerMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  const src = mediaSource(input, "buildSticker");
  return withReplyTo(
    {
      ...BASE_PAYLOAD,
      to,
      type: "sticker",
      sticker: src.id !== undefined ? { id: src.id } : { link: src.link! },
    },
    replyTo
  );
}

// ───────────── Location ─────────────

export interface BuildLocationInput {
  to: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  replyTo?: string;
}

export function buildLocation(input: BuildLocationInput): LocationMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  const latitude = ensureNumberInRange(input.latitude, -90, 90, "buildLocation.latitude");
  const longitude = ensureNumberInRange(input.longitude, -180, 180, "buildLocation.longitude");
  const location: LocationMessage["location"] = { latitude, longitude };
  if (input.name !== undefined) location.name = input.name;
  if (input.address !== undefined) location.address = input.address;
  return withReplyTo({ ...BASE_PAYLOAD, to, type: "location", location }, replyTo);
}

// ───────────── Contacts ─────────────

export interface BuildContactsInput {
  to: string;
  contacts: Contact | ReadonlyArray<Contact>;
  replyTo?: string;
}

export function buildContacts(input: BuildContactsInput): ContactsMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  const list: ReadonlyArray<Contact> = Array.isArray(input.contacts)
    ? (input.contacts as ReadonlyArray<Contact>)
    : [input.contacts as Contact];
  if (list.length === 0) fail("buildContacts: at least one contact is required.");
  for (const c of list) {
    const formatted = c.name.formatted_name;
    if (typeof formatted !== "string" || formatted.length === 0) {
      fail("buildContacts: every contact must include `name.formatted_name`.");
    }
  }
  return withReplyTo({ ...BASE_PAYLOAD, to, type: "contacts", contacts: list }, replyTo);
}

// ───────────── Interactive ─────────────

export interface BuildInteractiveButtonInput {
  to: string;
  header?: InteractiveHeader;
  body: string;
  footer?: string;
  buttons: ReadonlyArray<{ id: string; title: string }>;
  replyTo?: string;
}

export function buildInteractiveButton(input: BuildInteractiveButtonInput): InteractiveMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  if (typeof input.body !== "string" || input.body.length === 0) {
    fail("buildInteractiveButton: `body` must be a non-empty string.");
  }
  if (input.buttons.length < 1 || input.buttons.length > 3) {
    fail("buildInteractiveButton: `buttons` must contain 1 to 3 entries.");
  }
  for (const b of input.buttons) {
    if (
      typeof b.id !== "string" ||
      b.id.length === 0 ||
      typeof b.title !== "string" ||
      b.title.length === 0
    ) {
      fail("buildInteractiveButton: every button needs a non-empty `id` and `title`.");
    }
  }
  const interactive: InteractiveButtonBody = {
    type: "button",
    body: { text: input.body },
    action: {
      buttons: input.buttons.map((b) => ({
        type: "reply" as const,
        reply: { id: b.id, title: b.title },
      })),
    },
  };
  if (input.header !== undefined) interactive.header = input.header;
  if (input.footer !== undefined) interactive.footer = { text: input.footer };
  return withReplyTo({ ...BASE_PAYLOAD, to, type: "interactive", interactive }, replyTo);
}

export interface BuildInteractiveListInput {
  to: string;
  header?: { type: "text"; text: string };
  body: string;
  footer?: string;
  button: string;
  sections: ReadonlyArray<InteractiveListSection>;
  replyTo?: string;
}

export function buildInteractiveList(input: BuildInteractiveListInput): InteractiveMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  if (typeof input.body !== "string" || input.body.length === 0) {
    fail("buildInteractiveList: `body` must be a non-empty string.");
  }
  if (typeof input.button !== "string" || input.button.length === 0) {
    fail("buildInteractiveList: `button` must be a non-empty string.");
  }
  if (input.sections.length < 1 || input.sections.length > 10) {
    fail("buildInteractiveList: `sections` must contain 1 to 10 entries.");
  }
  for (const s of input.sections) {
    if (typeof s.title !== "string" || s.title.length === 0) {
      fail("buildInteractiveList: every section needs a non-empty `title`.");
    }
    if (s.rows.length < 1 || s.rows.length > 10) {
      fail("buildInteractiveList: every section must have 1 to 10 rows.");
    }
    for (const r of s.rows) {
      if (typeof r.id !== "string" || r.id.length === 0) {
        fail("buildInteractiveList: every row needs a non-empty `id`.");
      }
      if (typeof r.title !== "string" || r.title.length === 0) {
        fail("buildInteractiveList: every row needs a non-empty `title`.");
      }
    }
  }
  const interactive: InteractiveListBody = {
    type: "list",
    body: { text: input.body },
    action: { button: input.button, sections: input.sections },
  };
  if (input.header !== undefined) interactive.header = input.header;
  if (input.footer !== undefined) interactive.footer = { text: input.footer };
  return withReplyTo({ ...BASE_PAYLOAD, to, type: "interactive", interactive }, replyTo);
}

export interface BuildInteractiveCtaUrlInput {
  to: string;
  header?: InteractiveHeader;
  body: string;
  footer?: string;
  cta: { displayText: string; url: string };
  replyTo?: string;
}

export function buildInteractiveCtaUrl(input: BuildInteractiveCtaUrlInput): InteractiveMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  if (typeof input.body !== "string" || input.body.length === 0) {
    fail("buildInteractiveCtaUrl: `body` must be a non-empty string.");
  }
  if (typeof input.cta?.displayText !== "string" || input.cta.displayText.length === 0) {
    fail("buildInteractiveCtaUrl: `cta.displayText` must be non-empty.");
  }
  try {
    new URL(input.cta.url);
  } catch {
    fail("buildInteractiveCtaUrl: `cta.url` must be a valid URL.");
  }
  const interactive: InteractiveCtaUrlBody = {
    type: "cta_url",
    body: { text: input.body },
    action: {
      name: "cta_url",
      parameters: { display_text: input.cta.displayText, url: input.cta.url },
    },
  };
  if (input.header !== undefined) interactive.header = input.header;
  if (input.footer !== undefined) interactive.footer = { text: input.footer };
  return withReplyTo({ ...BASE_PAYLOAD, to, type: "interactive", interactive }, replyTo);
}

export type BuildInteractiveInput =
  | ({ kind: "button" } & BuildInteractiveButtonInput)
  | ({ kind: "list" } & BuildInteractiveListInput)
  | ({ kind: "cta_url" } & BuildInteractiveCtaUrlInput);

export function buildInteractive(input: BuildInteractiveInput): InteractiveMessage {
  switch (input.kind) {
    case "button":
      return buildInteractiveButton(input);
    case "list":
      return buildInteractiveList(input);
    case "cta_url":
      return buildInteractiveCtaUrl(input);
    default: {
      const exhaustive: never = input;
      fail(
        `buildInteractive: unknown kind "${(exhaustive as { kind: string }).kind}". v1 supports button | list | cta_url.`
      );
    }
  }
}

// ───────────── Template ─────────────

export interface BuildTemplateInput {
  to: string;
  name: string;
  language: string;
  components?: ReadonlyArray<TemplateComponent>;
  replyTo?: string;
  /**
   * Optional approved-template definition to cross-validate against
   * before building. When supplied, parameter counts and component
   * shapes are checked locally and `TemplateError` is thrown on
   * mismatch, avoiding the wasted HTTP round-trip to Meta.
   */
  validateAgainst?: TemplateDefinition;
}

export function buildTemplate(input: BuildTemplateInput): TemplateMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  if (typeof input.name !== "string" || input.name.length === 0) {
    failTemplate("buildTemplate: `name` must be a non-empty string.", input.name);
  }
  if (typeof input.language !== "string" || input.language.length === 0) {
    failTemplate("buildTemplate: `language` must be a non-empty BCP-47 code.", input.name);
  }
  // Sanity-check components: every parameter array must be present (1-indexed
  // contract honoured by the caller). We do NOT cross-validate against an
  // approved template definition — that is Phase 5's job.
  if (input.components) {
    for (const c of input.components) {
      if (
        !["header", "body", "button", "footer", "carousel", "limited_time_offer"].includes(c.type)
      ) {
        failTemplate(`buildTemplate: invalid component.type "${c.type}".`, input.name);
      }
      if (c.type === "button" && c.sub_type === undefined) {
        failTemplate(
          "buildTemplate: button components require a `sub_type` (quick_reply | url | copy_code).",
          input.name
        );
      }
    }
  }
  const template: TemplateBody = {
    name: input.name,
    language: { code: input.language },
  };
  if (input.components !== undefined) template.components = input.components;
  const payload: TemplateMessage = withReplyTo(
    { ...BASE_PAYLOAD, to, type: "template", template },
    replyTo
  );
  if (input.validateAgainst !== undefined) {
    validateTemplateSend(payload, input.validateAgainst);
  }
  return payload;
}

// ───────────── Reaction ─────────────

export interface BuildReactionInput {
  to: string;
  messageId: string;
  /** Empty string clears a previously set reaction. */
  emoji: string;
  replyTo?: string;
}

export function buildReaction(input: BuildReactionInput): ReactionMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  if (typeof input.messageId !== "string" || input.messageId.length === 0) {
    fail("buildReaction: `messageId` (wamid) must be a non-empty string.");
  }
  if (typeof input.emoji !== "string") {
    fail('buildReaction: `emoji` must be a string (use "" to clear).');
  }
  return withReplyTo(
    {
      ...BASE_PAYLOAD,
      to,
      type: "reaction",
      reaction: { message_id: input.messageId, emoji: input.emoji },
    },
    replyTo
  );
}

// ───────────── Authentication template (OTP) ─────────────

export interface BuildAuthTemplateInput {
  to: string;
  /** Template name (case-sensitive, must exist as APPROVED in your WABA). */
  name: string;
  /** BCP-47 language code — must match the approved template's language. */
  language: string;
  /**
   * The one-time password / verification code. Meta caps this at 15
   * characters. Appears in BOTH the body and URL-button parameters of
   * the documented wire payload — the builder duplicates it for you.
   */
  otp: string;
  /**
   * Index of the URL button on the approved template. Defaults to `"0"`
   * (matches Meta's documented example). Override only if your approved
   * template has the OTP button at a non-zero position.
   */
  otpButtonIndex?: string | number;
  replyTo?: string;
}

/**
 * Build an authentication-template (OTP) send payload. The wire shape
 * matches Meta's documented copy-code button authentication template
 * payload at
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates/.
 *
 * The same wire shape applies to one-tap autofill and zero-tap
 * authentication templates — the subtype distinction lives at template
 * creation time (Meta Business Manager / the templates API), not at
 * send time.
 *
 * The OTP code appears in BOTH the body component's `text` parameter
 * AND the URL button component's `text` parameter. This is Meta's
 * documented requirement, not an SDK quirk; the builder duplicates the
 * code so consumers don't have to remember to pass it twice.
 */
export function buildAuthTemplate(input: BuildAuthTemplateInput): TemplateMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  if (typeof input.name !== "string" || input.name.length === 0) {
    failTemplate("buildAuthTemplate: `name` must be a non-empty string.", input.name);
  }
  if (typeof input.language !== "string" || input.language.length === 0) {
    failTemplate("buildAuthTemplate: `language` must be a non-empty BCP-47 code.", input.name);
  }
  if (typeof input.otp !== "string" || input.otp.length === 0) {
    failTemplate("buildAuthTemplate: `otp` must be a non-empty string.", input.name);
  }
  if (input.otp.length > 15) {
    failTemplate(
      `buildAuthTemplate: \`otp\` exceeds Meta's 15-character maximum (got ${input.otp.length}).`,
      input.name
    );
  }
  const buttonIndex: string | number = input.otpButtonIndex ?? "0";
  const components: ReadonlyArray<TemplateComponent> = [
    { type: "body", parameters: [{ type: "text", text: input.otp }] },
    {
      type: "button",
      sub_type: "url",
      index: buttonIndex,
      parameters: [{ type: "text", text: input.otp }],
    },
  ];
  return withReplyTo(
    {
      ...BASE_PAYLOAD,
      to,
      type: "template",
      template: { name: input.name, language: { code: input.language }, components },
    },
    replyTo
  );
}

// ───────────── Voice note ─────────────

export interface BuildVoiceInput {
  to: string;
  /** Pre-uploaded media id from `POST /{phone-number-id}/media`. Exactly one of `id` / `link` must be supplied. */
  id?: string;
  /** Public URL Meta will fetch on send. Exactly one of `id` / `link` must be supplied. */
  link?: string;
  replyTo?: string;
}

/**
 * Build a voice-note send payload — an audio message with the
 * `voice: true` flag set. Source:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages
 *
 * Setting `voice: true` triggers transcription support, auto-download,
 * and a "played" delivery status when the recipient listens. Without
 * the flag the same media renders as a regular audio file with the
 * music-player UI.
 *
 * The media payload (`.ogg` with OPUS codec is recommended) is supplied
 * the same way as for `buildAudio` — either a pre-uploaded media id or
 * a public link.
 */
export function buildVoice(input: BuildVoiceInput): AudioMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  exactlyOne(input.id, input.link, "buildVoice");
  const audio: AudioMessage["audio"] =
    typeof input.id === "string" && input.id.length > 0
      ? { id: input.id, voice: true }
      : { link: input.link!, voice: true };
  return withReplyTo({ ...BASE_PAYLOAD, to, type: "audio", audio }, replyTo);
}

// ───────────── Carousel template ─────────────

export interface CarouselCardMediaHeader {
  type: "image" | "video";
  /** Pre-uploaded media id. Exactly one of `mediaId` / `link` must be supplied. */
  mediaId?: string;
  /** Public link. Exactly one of `mediaId` / `link` must be supplied. */
  link?: string;
}

export type CarouselCardButton =
  | { subType: "quick_reply"; payload: string }
  | { subType: "url"; text: string };

export interface CarouselCard {
  /** Image or video header for this card (required by Meta). */
  header: CarouselCardMediaHeader;
  /** Body-text variable substitutions for this card's approved-template body. */
  bodyParameters?: ReadonlyArray<string>;
  /**
   * Up to two buttons per card (Meta cap). Order matters — the index
   * in the wire payload is the position in this array.
   */
  buttons?: ReadonlyArray<CarouselCardButton>;
}

export interface BuildCarouselTemplateInput {
  to: string;
  name: string;
  language: string;
  /** Top-level body-text variable substitutions for the carousel's leading body component. */
  bodyParameters?: ReadonlyArray<string>;
  cards: ReadonlyArray<CarouselCard>;
  replyTo?: string;
}

const CAROUSEL_MAX_CARDS = 10;

/**
 * Build a media-card carousel template send payload. The wire shape
 * matches Meta's documented payload at
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates/.
 *
 * Cards are bounded to 1–10 per Meta's documented maximum. Each card's
 * `card_index` is computed from its position in the input array so
 * consumers cannot misorder it.
 */
export function buildCarouselTemplate(input: BuildCarouselTemplateInput): TemplateMessage {
  const to = ensureRecipient(input.to);
  const replyTo = ensureReplyTo(input.replyTo);
  if (typeof input.name !== "string" || input.name.length === 0) {
    failTemplate("buildCarouselTemplate: `name` must be a non-empty string.", input.name);
  }
  if (typeof input.language !== "string" || input.language.length === 0) {
    failTemplate("buildCarouselTemplate: `language` must be a non-empty BCP-47 code.", input.name);
  }
  const cards = input.cards;
  // `Array.isArray` narrows ReadonlyArray<T> to any[], so we test
  // length directly and use a runtime typeof guard for the worst case
  // (caller passing a non-array via untyped JS).
  if (
    cards === null ||
    typeof cards !== "object" ||
    typeof (cards as { length?: unknown }).length !== "number"
  ) {
    failTemplate("buildCarouselTemplate: `cards` must be a non-empty array.", input.name);
  }
  if (cards.length === 0) {
    failTemplate("buildCarouselTemplate: `cards` must be a non-empty array.", input.name);
  }
  if (cards.length > CAROUSEL_MAX_CARDS) {
    failTemplate(
      `buildCarouselTemplate: cards.length (${cards.length}) exceeds Meta's ${CAROUSEL_MAX_CARDS}-card maximum.`,
      input.name
    );
  }

  const topLevelComponents: TemplateComponent[] = [];
  if (input.bodyParameters !== undefined && input.bodyParameters.length > 0) {
    topLevelComponents.push({
      type: "body",
      parameters: input.bodyParameters.map((text) => ({ type: "text", text })),
    });
  }
  topLevelComponents.push({
    type: "carousel",
    cards: cards.map((card, cardIndex) => buildCarouselCard(card, cardIndex, input.name)),
  });

  return withReplyTo(
    {
      ...BASE_PAYLOAD,
      to,
      type: "template",
      template: {
        name: input.name,
        language: { code: input.language },
        components: topLevelComponents,
      },
    },
    replyTo
  );
}

function buildCarouselCard(
  card: CarouselCard,
  cardIndex: number,
  templateName: string
): CarouselCardComponent {
  // Required header — exactly one of mediaId / link.
  const headerSource = card.header;
  if (typeof headerSource?.type !== "string" || !["image", "video"].includes(headerSource.type)) {
    failTemplate(
      `buildCarouselTemplate: card[${cardIndex}].header.type must be "image" or "video".`,
      templateName
    );
  }
  exactlyOne(
    headerSource.mediaId,
    headerSource.link,
    `buildCarouselTemplate: card[${cardIndex}].header`
  );

  const mediaParam =
    typeof headerSource.mediaId === "string" && headerSource.mediaId.length > 0
      ? { id: headerSource.mediaId }
      : { link: headerSource.link! };
  const headerParam: TemplateParameter =
    headerSource.type === "image"
      ? { type: "image", image: mediaParam }
      : { type: "video", video: mediaParam };

  const components: TemplateComponent[] = [{ type: "header", parameters: [headerParam] }];

  if (card.bodyParameters !== undefined && card.bodyParameters.length > 0) {
    components.push({
      type: "body",
      parameters: card.bodyParameters.map((text) => ({ type: "text", text })),
    });
  }

  if (card.buttons !== undefined) {
    card.buttons.forEach((btn, btnIndex) => {
      if (btn.subType === "quick_reply") {
        components.push({
          type: "button",
          sub_type: "quick_reply",
          index: btnIndex,
          parameters: [{ type: "payload", payload: btn.payload }],
        });
      } else {
        components.push({
          type: "button",
          sub_type: "url",
          index: btnIndex,
          parameters: [{ type: "text", text: btn.text }],
        });
      }
    });
  }

  return { card_index: cardIndex, components };
}
