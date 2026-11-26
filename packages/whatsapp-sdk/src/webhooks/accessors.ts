// Pure, never-throwing accessors over `MessageEvent.body` (the raw Meta
// `messages[i]` object). They narrow the documented shapes so consumers
// do not have to hand-roll `body["interactive"]["button_reply"]["id"]`.

import type { MessageEvent } from "./events.js";

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined;
}

function str(o: Obj | undefined, key: string): string | undefined {
  const v = o?.[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * A stable, non-empty-when-possible key for the sender: the phone-number
 * WA id (`from`) when Meta sent one, otherwise the BSUID
 * (`fromUserId`). Returns `""` only when the payload carried neither.
 *
 * Phone first keeps keys identical for every pre-BSUID integration and
 * matches the `to` you pass to outbound sends / the window tracker;
 * username-only users (no shareable phone) fall back to their BSUID
 * instead of all collapsing onto `""`.
 */
export function messageSenderKey(e: MessageEvent): string {
  if (e.from !== "") return e.from;
  return e.fromUserId ?? "";
}

/**
 * User-visible text of the message: `text.body`, the template
 * quick-reply `button.text`, or the interactive `button_reply` /
 * `list_reply` title. `undefined` for every other type.
 */
export function messageText(e: MessageEvent): string | undefined {
  const b = e.body;
  const text = str(obj(b["text"]), "body");
  if (text !== undefined) return text;
  const button = str(obj(b["button"]), "text");
  if (button !== undefined) return button;
  const interactive = obj(b["interactive"]);
  return (
    str(obj(interactive?.["button_reply"]), "title") ??
    str(obj(interactive?.["list_reply"]), "title")
  );
}

/**
 * Machine-readable reply id: interactive `button_reply.id` /
 * `list_reply.id`, or the template quick-reply `button.payload`.
 */
export function messageReplyId(e: MessageEvent): string | undefined {
  const b = e.body;
  const interactive = obj(b["interactive"]);
  return (
    str(obj(interactive?.["button_reply"]), "id") ??
    str(obj(interactive?.["list_reply"]), "id") ??
    str(obj(b["button"]), "payload")
  );
}

export type InboundMediaKind = "image" | "video" | "audio" | "document" | "sticker";

export interface InboundMedia {
  kind: InboundMediaKind;
  /** Media id — pass to `client.downloadMedia` / `getMediaUrl`. */
  id: string;
  mimeType?: string;
  sha256?: string;
  /** Direct download URL Meta is rolling out (still requires the access token). */
  url?: string;
  /** audio only: `true` for a WhatsApp voice recording. */
  voice?: boolean;
  /** sticker only. */
  animated?: boolean;
  /** image / video / document. */
  caption?: string;
  /** document only. */
  filename?: string;
}

const MEDIA_KINDS: ReadonlySet<string> = new Set([
  "image",
  "video",
  "audio",
  "document",
  "sticker",
]);

/** Typed media descriptor for image / video / audio / document / sticker messages. */
export function messageMedia(e: MessageEvent): InboundMedia | undefined {
  if (!MEDIA_KINDS.has(e.type)) return undefined;
  const kind = e.type as InboundMediaKind;
  const m = obj(e.body[kind]);
  const id = str(m, "id");
  if (m === undefined || id === undefined || id === "") return undefined;
  const out: InboundMedia = { kind, id };
  const mimeType = str(m, "mime_type");
  if (mimeType !== undefined) out.mimeType = mimeType;
  const sha256 = str(m, "sha256");
  if (sha256 !== undefined) out.sha256 = sha256;
  const url = str(m, "url");
  if (url !== undefined) out.url = url;
  if (typeof m["voice"] === "boolean") out.voice = m["voice"];
  if (typeof m["animated"] === "boolean") out.animated = m["animated"];
  const caption = str(m, "caption");
  if (caption !== undefined) out.caption = caption;
  const filename = str(m, "filename");
  if (filename !== undefined) out.filename = filename;
  return out;
}

/** camelCase view of {@link MessageEvent.referral} per Meta's current reference. */
export interface NormalisedReferral {
  /** Absent for ads shown in WhatsApp Status. */
  ctwaClid?: string;
  sourceId?: string;
  sourceType?: string;
  sourceUrl?: string;
  headline?: string;
  body?: string;
  mediaType?: string;
  imageUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  welcomeMessageText?: string;
  /** @deprecated Legacy `media_url`; not in Meta's current reference. */
  mediaUrl?: string;
}

const REFERRAL_FIELDS = [
  ["ctwa_clid", "ctwaClid"],
  ["source_id", "sourceId"],
  ["source_type", "sourceType"],
  ["source_url", "sourceUrl"],
  ["headline", "headline"],
  ["body", "body"],
  ["media_type", "mediaType"],
  ["image_url", "imageUrl"],
  ["video_url", "videoUrl"],
  ["thumbnail_url", "thumbnailUrl"],
  ["media_url", "mediaUrl"],
] as const;

/**
 * Normalised CTWA referral, or `undefined` when the message has none.
 * An empty `referral: {}` yields `{}`.
 */
export function messageReferral(e: MessageEvent): NormalisedReferral | undefined {
  const r = obj(e.referral);
  if (r === undefined) return undefined;
  const out: NormalisedReferral = {};
  for (const [src, dst] of REFERRAL_FIELDS) {
    const v = str(r, src);
    if (v !== undefined) out[dst] = v;
  }
  const welcome = str(obj(r["welcome_message"]), "text");
  if (welcome !== undefined) out.welcomeMessageText = welcome;
  return out;
}

/**
 * Identity rotation carried by a `system` message. Meta has no separate
 * webhook field for BSUID changes: they arrive here, and this is how you
 * join the new identity to the one you already have on file.
 */
export type IdentityChange =
  | {
      type: "user_changed_user_id";
      userId?: string;
      parentUserId?: string;
      previousUserId?: string;
      previousParentUserId?: string;
    }
  | {
      type: "user_changed_number";
      /** New phone-number WA id (`system.wa_id`). */
      waId?: string;
      /** Previous phone-number WA id (the message `from`). */
      previousWaId?: string;
      userId?: string;
    };

/** `user_changed_user_id` / `user_changed_number` details, else `undefined`. */
export function messageIdentityChange(e: MessageEvent): IdentityChange | undefined {
  if (e.type !== "system") return undefined;
  const sys = obj(e.body["system"]);
  const type = str(sys, "type");
  if (type === "user_changed_user_id") {
    const out: IdentityChange = { type };
    const userId = str(sys, "user_id");
    if (userId !== undefined) out.userId = userId;
    const parentUserId = str(sys, "parent_user_id");
    if (parentUserId !== undefined) out.parentUserId = parentUserId;
    const previousUserId = str(sys, "previous_user_id");
    if (previousUserId !== undefined) out.previousUserId = previousUserId;
    const previousParentUserId = str(sys, "previous_parent_user_id");
    if (previousParentUserId !== undefined) out.previousParentUserId = previousParentUserId;
    return out;
  }
  if (type === "user_changed_number") {
    const out: IdentityChange = { type };
    const waId = str(sys, "wa_id");
    if (waId !== undefined) out.waId = waId;
    if (e.from !== "") out.previousWaId = e.from;
    const userId = str(sys, "user_id");
    if (userId !== undefined) out.userId = userId;
    return out;
  }
  return undefined;
}
