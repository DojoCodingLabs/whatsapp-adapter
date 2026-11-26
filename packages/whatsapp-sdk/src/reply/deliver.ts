// The agent-facing outbound path: one `Reply` in, one or more Cloud
// API sends out. Ported from doji-agent `src/whatsapp/reply.ts`
// (deliverReply) without any consumer copy: the continuation body
// is a caller option.

import type { RequestOptions } from "../client/transport.js";
import type { BuildInteractiveInput, BuildTextInput } from "../messages/builders.js";
import type { MessageSendResponse } from "../messages/types.js";
import {
  AccountRestrictedError,
  AuthenticationError,
  MissingCredentialsError,
  MockModeError,
  NetworkError,
  OptOutError,
  PermissionError,
  RateLimitError,
  RequestAbortedError,
  TransientError,
  UndeliverableError,
  WhatsAppError,
  WindowClosedError,
} from "../types/errors.js";

import {
  addressOf,
  interactiveBodyLimit,
  type Reply,
  replyAsText,
  toInteractiveReply,
} from "./interactive.js";
import { splitText } from "./text.js";

/**
 * The slice of `WhatsAppClient` `deliverReply` needs. Both
 * `WhatsAppClient` and `MockWhatsAppClient` satisfy it.
 */
export interface ReplyClient {
  sendText(input: BuildTextInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendInteractive(
    input: BuildInteractiveInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse>;
}

export interface DeliverReplyOptions {
  /**
   * Short body for the interactive message that follows a prompt too
   * long for Meta's interactive body limit (the prompt itself goes
   * out first as text). Consumers SHOULD set this in their own
   * language and tone. Default: `"…"`.
   */
  continuationBody?: string;
  /**
   * `preview_url` for text parts. `"auto"` (default) enables the
   * link preview when the part contains an `http(s)://` URL.
   */
  previewUrl?: boolean | "auto";
  /** Quote this inbound wamid on the FIRST message sent. */
  replyTo?: string;
  /** Forwarded to every send (signal, retryPolicy, …). */
  requestOptions?: RequestOptions;
}

export interface DeliveredReply {
  /** What actually went out: `"text"` after a fallback. */
  kind: Reply["kind"];
  /** Number of Cloud API messages sent. */
  messages: number;
  /** Set when Meta refused the interactive message and it was re-sent as text. */
  fallback?: true;
  /** wamids of the sent messages, in order. */
  messageIds: string[];
}

/** Default {@link DeliverReplyOptions.continuationBody}. Neutral: no copy, no emoji. */
export const DEFAULT_CONTINUATION_BODY = "…";

/**
 * Errors that MUST reach the caller instead of triggering the
 * plain-text fallback: the same send as text would fail the same way
 * (window, opt-out, credentials, account, recipient) or may already
 * have been delivered (transient / network / abort — resending risks
 * a duplicate).
 */
const PROPAGATE: ReadonlyArray<abstract new (...args: never[]) => WhatsAppError> = [
  WindowClosedError,
  OptOutError,
  AuthenticationError,
  RateLimitError,
  MissingCredentialsError,
  PermissionError,
  AccountRestrictedError,
  UndeliverableError,
  TransientError,
  NetworkError,
  RequestAbortedError,
  MockModeError,
];

/**
 * Whether a failed interactive send should be retried as plain text:
 * any `WhatsAppError` (Meta rejected the payload — `CapabilityError`
 * for code 100 / 131009, `UNKNOWN`, or the strict builder refusing
 * what was left after clipping) EXCEPT the classes listed in
 * `PROPAGATE`. Non-`WhatsAppError`s always propagate.
 */
export function isInteractiveFallbackError(err: unknown): boolean {
  if (!(err instanceof WhatsAppError)) return false;
  return !PROPAGATE.some((cls) => err instanceof cls);
}

const URL_RE = /https?:\/\//;

/**
 * Send one agent {@link Reply}.
 *
 * - `text`: split into ≤ 4096-code-point messages (never truncated).
 * - `buttons` / `list` / `cta_url`: built with {@link toInteractiveReply}.
 *   A body over the kind's interactive limit is sent first as text
 *   parts, then the interactive goes out with
 *   `options.continuationBody`.
 * - If the interactive send fails with a fallback-eligible error
 *   ({@link isInteractiveFallbackError}), the reply is re-sent as
 *   numbered plain text ({@link replyAsText}) and the result carries
 *   `fallback: true`. `WindowClosedError`, `OptOutError`,
 *   `AuthenticationError`, `RateLimitError` (and the other classes
 *   documented above) propagate unchanged.
 *
 * Sends are sequential so the recipient sees parts in order.
 */
export async function deliverReply(
  client: ReplyClient,
  to: string,
  reply: Reply,
  options: DeliverReplyOptions = {}
): Promise<DeliveredReply> {
  const messageIds: string[] = [];
  let replyTo = options.replyTo;
  const previewUrl = options.previewUrl ?? "auto";

  const record = (res: MessageSendResponse): void => {
    replyTo = undefined;
    for (const m of res.messages) messageIds.push(m.id);
  };
  const sendParts = async (text: string): Promise<number> => {
    const parts = splitText(text);
    for (const body of parts) {
      const preview = previewUrl === "auto" ? URL_RE.test(body) : previewUrl;
      record(
        await client.sendText(
          {
            ...addressOf(to),
            body,
            ...(preview ? { previewUrl: true } : {}),
            ...(replyTo ? { replyTo } : {}),
          },
          options.requestOptions
        )
      );
    }
    return parts.length;
  };

  if (reply.kind === "text") {
    const messages = await sendParts(reply.body);
    return { kind: "text", messages, messageIds };
  }

  let sent = 0;
  let body = reply.body;
  if (Array.from(body.trim()).length > interactiveBodyLimit(reply.kind)) {
    // Never truncate: the long prompt goes as text, the choices follow
    // with a short body.
    sent += await sendParts(body);
    body = options.continuationBody ?? DEFAULT_CONTINUATION_BODY;
  }

  try {
    const input = toInteractiveReply(to, reply, { body, ...(replyTo ? { replyTo } : {}) });
    record(await client.sendInteractive(input, options.requestOptions));
    return { kind: reply.kind, messages: sent + 1, messageIds };
  } catch (err) {
    if (!isInteractiveFallbackError(err)) throw err;
    const messages = await sendParts(replyAsText({ ...reply, body }));
    return { kind: "text", messages: sent + messages, fallback: true, messageIds };
  }
}
