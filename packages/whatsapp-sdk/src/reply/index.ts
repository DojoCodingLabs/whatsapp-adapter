// Capability: agent-reply. Agent-facing helpers on top of the strict
// builders: split / clip text, tolerant interactive builders,
// deliverReply with plain-text fallback, the outbound-mode decision
// and free-text opt-out detection.

export { clipText, splitText, toWhatsAppText } from "./text.js";
export {
  interactiveBodyLimit,
  type InteractiveReply,
  MAX_LIST_ROWS,
  MAX_REPLY_BUTTONS,
  type Reply,
  replyAsText,
  type ReplyOption,
  toInteractiveReply,
  type ToInteractiveReplyOptions,
} from "./interactive.js";
export {
  DEFAULT_CONTINUATION_BODY,
  deliverReply,
  type DeliveredReply,
  type DeliverReplyOptions,
  isInteractiveFallbackError,
  type ReplyClient,
} from "./deliver.js";
export {
  type OutboundMode,
  outboundMode,
  type OutboundModeInput,
  WINDOW_MARGIN_MS,
} from "./window.js";
export { detectOptOut, OPT_OUT_MAX_LENGTH } from "./opt-out.js";
