// Tolerant interactive builders for LLM agents. An agent hands over
// whatever titles it produced; these helpers clip, dedupe and cap
// them to Meta's limits and return an input the SDK's STRICT
// builders (`buildInteractiveButton` / `List` / `CtaUrl`) accept.
// Limits come from MESSAGE_LENGTH_LIMITS — never duplicated here.
// Ported from doji-agent `src/whatsapp/graph.ts` (options / frame).

import type {
  BuildInteractiveButtonInput,
  BuildInteractiveCtaUrlInput,
  BuildInteractiveInput,
  BuildInteractiveListInput,
} from "../messages/builders.js";
import { isBsuid } from "../messages/builders.js";
import { MESSAGE_LENGTH_LIMITS } from "../types/constants.js";

import { clipText } from "./text.js";

/** Meta caps reply buttons at 3 per message. */
export const MAX_REPLY_BUTTONS = 3;
/** Meta caps list messages at 10 rows across all sections. */
export const MAX_LIST_ROWS = 10;

// TODO(list-body-limit): Meta documents 4096 characters for a LIST
// message body (1024 for button / cta_url). The strict builder still
// enforces `interactiveBody` for lists; a separate change adds
// `MESSAGE_LENGTH_LIMITS.listBody`. Read it when present so this file
// picks the corrected limit up automatically.
const LIST_BODY_LIMIT: number =
  (MESSAGE_LENGTH_LIMITS as Readonly<Record<string, number>>)["listBody"] ??
  MESSAGE_LENGTH_LIMITS.interactiveBody;

/** One choice an agent offers (a reply button or a list row). */
export interface ReplyOption {
  /** Payload echoed back in the webhook when tapped. Defaults to `title`. */
  id?: string;
  title: string;
  /** List rows only; ignored for buttons. */
  description?: string;
}

interface InteractiveFrame {
  body: string;
  /** Plain-text header. */
  header?: string;
  footer?: string;
}

/** A reply an agent wants to send. `text` bodies may be any length. */
export type Reply =
  | { kind: "text"; body: string }
  | ({ kind: "buttons"; buttons: ReadonlyArray<ReplyOption> } & InteractiveFrame)
  | ({
      kind: "list";
      /** Label of the button that opens the list. */
      button: string;
      rows: ReadonlyArray<ReplyOption>;
      /** Title of the single section. Defaults to `button`. */
      sectionTitle?: string;
    } & InteractiveFrame)
  | ({ kind: "cta_url"; cta: { label: string; url: string } } & InteractiveFrame);

/** The interactive members of {@link Reply}. */
export type InteractiveReply = Exclude<Reply, { kind: "text" }>;

/**
 * Meta's body ceiling (code points) for an interactive reply of this
 * kind: 1024 for buttons / cta_url; the list limit for lists.
 */
export function interactiveBodyLimit(kind: InteractiveReply["kind"]): number {
  return kind === "list" ? LIST_BODY_LIMIT : MESSAGE_LENGTH_LIMITS.interactiveBody;
}

/** Unique, clipped options: WhatsApp rejects duplicate titles or ids. */
function pickOptions(
  items: ReadonlyArray<ReplyOption>,
  max: number,
  titleMax: number,
  idMax: number
): Array<{ id: string; title: string; description?: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; title: string; description?: string }> = [];
  for (const item of items) {
    const title = clipText(item.title, titleMax);
    const id = clipText(item.id || item.title, idMax);
    if (!title || !id || seen.has(title) || seen.has(id)) continue;
    seen.add(title).add(id);
    const description =
      item.description === undefined
        ? ""
        : clipText(item.description, MESSAGE_LENGTH_LIMITS.listRowDescription);
    out.push({ id, title, ...(description ? { description } : {}) });
    if (out.length === max) break;
  }
  return out;
}

function frame(
  reply: InteractiveFrame,
  body: string,
  bodyMax: number
): { body: string; header?: { type: "text"; text: string }; footer?: string } {
  const header = reply.header
    ? clipText(reply.header, MESSAGE_LENGTH_LIMITS.interactiveHeaderText)
    : "";
  const footer = reply.footer
    ? clipText(reply.footer, MESSAGE_LENGTH_LIMITS.interactiveFooter)
    : "";
  return {
    body: clipText(body, bodyMax),
    ...(header ? { header: { type: "text" as const, text: header } } : {}),
    ...(footer ? { footer } : {}),
  };
}

export interface ToInteractiveReplyOptions {
  /** Replace the reply's body (e.g. a short continuation after a long prompt went out as text). */
  body?: string;
  /** Quote an inbound message (`context.message_id`). */
  replyTo?: string;
}

/**
 * Address a send at a phone number (`to`) or, when `id` is a
 * business-scoped user id (BSUID), at `recipient`.
 */
export function addressOf(id: string): { to: string } | { recipient: string } {
  return isBsuid(id) ? { recipient: id } : { to: id };
}

/**
 * Turn an agent's {@link InteractiveReply} into a
 * {@link BuildInteractiveInput} for `client.sendInteractive(...)`:
 * header / body / footer / titles / labels are clipped to
 * `MESSAGE_LENGTH_LIMITS` (with `…`), duplicate ids or titles are
 * dropped, buttons are capped at 3 and rows at 10.
 *
 * The strict builders still validate the result; they can reject it
 * when nothing usable is left (empty body, zero options, invalid
 * `cta.url`). `deliverReply` treats that like a Meta rejection and
 * falls back to plain text.
 */
export function toInteractiveReply(
  to: string,
  reply: InteractiveReply,
  opts: ToInteractiveReplyOptions = {}
): BuildInteractiveInput {
  const body = opts.body ?? reply.body;
  const replyTo = opts.replyTo !== undefined ? { replyTo: opts.replyTo } : {};
  switch (reply.kind) {
    case "buttons": {
      const input: BuildInteractiveButtonInput = {
        ...addressOf(to),
        ...frame(reply, body, interactiveBodyLimit("buttons")),
        buttons: pickOptions(
          reply.buttons,
          MAX_REPLY_BUTTONS,
          MESSAGE_LENGTH_LIMITS.replyButtonTitle,
          MESSAGE_LENGTH_LIMITS.replyButtonId
        ).map(({ id, title }) => ({ id, title })),
        ...replyTo,
      };
      return { kind: "button", ...input };
    }
    case "list": {
      const { header, ...rest } = frame(reply, body, interactiveBodyLimit("list"));
      const input: BuildInteractiveListInput = {
        ...addressOf(to),
        ...rest,
        ...(header !== undefined ? { header } : {}),
        button: clipText(reply.button, MESSAGE_LENGTH_LIMITS.listButton),
        sections: [
          {
            title: clipText(
              reply.sectionTitle || reply.button,
              MESSAGE_LENGTH_LIMITS.listSectionTitle
            ),
            rows: pickOptions(
              reply.rows,
              MAX_LIST_ROWS,
              MESSAGE_LENGTH_LIMITS.listRowTitle,
              MESSAGE_LENGTH_LIMITS.listRowId
            ),
          },
        ],
        ...replyTo,
      };
      return { kind: "list", ...input };
    }
    case "cta_url": {
      const input: BuildInteractiveCtaUrlInput = {
        ...addressOf(to),
        ...frame(reply, body, interactiveBodyLimit("cta_url")),
        cta: {
          displayText: clipText(reply.cta.label, MESSAGE_LENGTH_LIMITS.ctaUrlDisplayText),
          url: reply.cta.url,
        },
        ...replyTo,
      };
      return { kind: "cta_url", ...input };
    }
  }
}

/**
 * Plain-text version of a reply — the fallback when Meta refuses the
 * interactive message. Buttons and rows become a numbered list
 * (`1. Title`, rows with `(description)`); a cta_url appends its URL.
 */
export function replyAsText(reply: Reply): string {
  switch (reply.kind) {
    case "buttons":
      return `${reply.body}\n${reply.buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n")}`;
    case "list":
      return `${reply.body}\n${reply.rows
        .map((r, i) => `${i + 1}. ${r.title}${r.description ? ` (${r.description})` : ""}`)
        .join("\n")}`;
    case "cta_url":
      return `${reply.body}\n${reply.cta.url}`;
    case "text":
      return reply.body;
  }
}
