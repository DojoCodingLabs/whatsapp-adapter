import type { WhatsAppLikeClient } from "../mock/types.js";
import type { IncomingMessageKind, MessageEvent, WhatsAppReferral } from "../webhooks/events.js";
import type { WebhookReceiver } from "../webhooks/receiver.js";
import type { WindowTracker } from "../window/tracker.js";

/**
 * Pluggable inbox interface. Mirrors `Storage` and `OptInRegistry` —
 * one async method, plug-replaceable. The bridge calls `append` once
 * per inbound message that survives the takeover gate and the
 * transform filter.
 *
 * Implementations are free to apply their own retry / backpressure
 * / fan-out semantics. The bridge treats rejection from `append` as
 * "the inbox failed" and routes through the optional `onError`
 * callback without re-throwing into the receiver dispatch (Meta's
 * 30 s ack rule wins).
 *
 * The bridge does NOT manage inbox lifecycle. Consumers wire up /
 * tear down their own backends.
 */
export interface AgentInbox {
  append(task: AgentTask): Promise<void>;
}

/**
 * Normalised inbound payload the default transform produces. The
 * shape flattens the most-needed fields out of `MessageEvent` so
 * agent runtimes don't have to re-parse Meta's wire shape per
 * message.
 *
 * Field absence (`undefined`) is the standard "this aspect doesn't
 * apply to this event" signal — e.g., `text` is absent on an image
 * message, `mediaIds` is absent on a text message.
 */
export interface AgentTask {
  /** Event timestamp normalised to epoch milliseconds. */
  receivedAt: number;
  /** Phone number id of the WABA-phone pair that received the event. */
  wabaPhoneNumberId?: string;
  /**
   * Logical conversation identifier. Defaults to `from` — consumers
   * with multi-channel routing override via their own transform.
   */
  conversationId: string;
  /** E.164 sender. */
  from: string;
  /** wamid — pass back into `sendReaction`, `markAsRead`, or as `replyTo`. */
  wamid: string;
  /** Normalised event kind (text / image / interactive_button_reply / …). */
  type: IncomingMessageKind;

  /** Body text when type is `text`. */
  text?: string;
  /** Media ids for image / video / audio / document / sticker. */
  mediaIds?: ReadonlyArray<string>;
  /** Quick-reply button id when type is `interactive_button_reply`. */
  buttonReplyId?: string;
  /** List-row id when type is `interactive_list_reply`. */
  listReplyId?: string;
  /** Location coordinates when type is `location`. */
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };

  /** Originating wamid this message replied to (when present in `context.id`). */
  replyToWamid?: string;
  /** Whether the 24h customer-service window is open, post-notify. */
  windowOpen?: boolean;
  /** CTWA / referral payload, propagated verbatim from `MessageEvent.referral`. */
  ctwaReferral?: WhatsAppReferral & Record<string, unknown>;

  /** Original event reference — escape hatch for fields the default transform skips. */
  raw: MessageEvent;
}

/**
 * Decision returned by an optional takeover check. The bridge calls
 * the callback BEFORE auto-ack and BEFORE enqueue. A truthy resolved
 * value short-circuits the dispatch — neither `markAsRead` nor
 * `inbox.append` fires.
 *
 * Typical use: a HITL inbox marks a conversation as "human-owned";
 * the takeover check looks the conversation up by `from` and returns
 * true while the human is active.
 */
export type TakeoverCheck = (event: MessageEvent) => boolean | Promise<boolean>;

/**
 * Custom transform. Returning `null` drops the event without
 * enqueueing — useful for inbound events the agent should ignore
 * (e.g., a button press for a closed flow).
 *
 * The bundled `defaultAgentTransform` covers the common case; this
 * callback is for consumers wanting a different `AgentTask` shape
 * or per-message filtering. Compose with the default:
 *
 *   transform: (e) => ({ ...defaultAgentTransform(e), tenantId: lookup(e) })
 */
export type AgentTaskTransform = (event: MessageEvent) => AgentTask | null;

/**
 * Input for {@link createAgentBridge}.
 */
export interface CreateAgentBridgeInput {
  /** The receiver to attach to. */
  receiver: WebhookReceiver;
  /**
   * Client used for the auto-`markAsRead` ack. Accepts the
   * `WhatsAppLikeClient` interface so mocks and policy wrappers
   * work without modification.
   */
  client: WhatsAppLikeClient;
  /** Where normalised tasks land. */
  inbox: AgentInbox;
  /**
   * Optional window tracker. When supplied, the bridge calls
   * `tracker.notifyInbound(event.from, event.timestamp)` BEFORE the takeover gate
   * and before extracting `windowOpen` into the task. Removes the
   * most-forgotten line in every hybrid cookbook.
   */
  windowTracker?: WindowTracker;
  /**
   * Optional HITL-takeover predicate. When supplied and returning
   * truthy, the bridge SKIPS the auto-ack AND the enqueue. The
   * consumer's HITL inbox is expected to handle the ack itself.
   */
  isOnTakeover?: TakeoverCheck;
  /**
   * Optional transform. Defaults to {@link defaultAgentTransform}.
   * Returning `null` drops the event without enqueueing.
   */
  transform?: AgentTaskTransform;
  /**
   * Fire `client.markAsRead({ messageId, typing })` before enqueue.
   * Defaults to `true`. The call is fire-and-forget — failures
   * never block the enqueue path.
   */
  autoMarkRead?: boolean;
  /**
   * Pair the auto-ack with `typing_indicator: { type: "text" }` so
   * the customer sees a typing state while the agent is producing
   * a response. Defaults to `true`. Only honoured when
   * `autoMarkRead` is `true`.
   */
  autoTyping?: boolean;
  /**
   * Optional error callback. Fires once per inbox rejection,
   * synchronously after the rejection is caught. The error is then
   * swallowed — the bridge never re-throws into the receiver
   * dispatch, since that would risk Meta's 30 s ack contract.
   */
  onError?: (err: unknown, event: MessageEvent) => void;
}

/**
 * Return type of {@link createAgentBridge}. Carries the disposer.
 */
export interface AgentBridge {
  /**
   * Detach the bridge's `message` handler from the receiver.
   * Idempotent — safe to call multiple times.
   */
  dispose(): void;
}
