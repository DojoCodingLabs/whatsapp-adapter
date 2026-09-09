import type { MessageEvent } from "../webhooks/events.js";

import { defaultAgentTransform } from "./transform.js";
import type { AgentBridge, AgentTask, CreateAgentBridgeInput } from "./types.js";

/**
 * Wire a `WebhookReceiver` to an `AgentInbox` with the canonical
 * front-desk dispatch sequence:
 *
 * 1. `windowTracker.notifyInbound(event.from, event.timestamp)` (if configured).
 * 2. `isOnTakeover?.(event)` — short-circuit on truthy.
 * 3. Fire-and-forget `client.markAsRead({ messageId, typing })`
 *    (if `autoMarkRead`).
 * 4. `(transform ?? defaultAgentTransform)(event)` — `null` skips
 *    enqueue.
 * 5. `await inbox.append(task)` — rejection routes to `onError`
 *    and is swallowed (Meta's 30 s ack rule wins).
 *
 * Returns a `{ dispose }` control that detaches the receiver
 * handler. Idempotent.
 *
 * @see docs/cookbook/hybrid/typing-while-thinking.md
 * @see docs/sdk/agent-bridge.md
 */
export function createAgentBridge(input: CreateAgentBridgeInput): AgentBridge {
  const {
    receiver,
    client,
    inbox,
    windowTracker,
    isOnTakeover,
    transform,
    autoMarkRead = true,
    autoTyping = true,
    onError,
  } = input;

  const handler = async (event: MessageEvent): Promise<void> => {
    // 1. Refresh the 24h window so subsequent state reads see the
    //    inbound. The most-forgotten line in every hybrid cookbook
    //    when written by hand.
    if (windowTracker !== undefined) {
      await windowTracker.notifyInbound(event.from, event.timestamp);
    }

    // 2. HITL takeover gate. When a human is in control, the
    //    bridge surrenders the dispatch entirely — including the
    //    ack, since the HITL inbox will ack on its own once the
    //    operator opens the conversation.
    if (isOnTakeover !== undefined) {
      try {
        const takeover = await isOnTakeover(event);
        if (takeover) return;
      } catch (err) {
        // Treat a takeover-check failure as "don't take over".
        // We surface via onError so the consumer notices, then
        // continue the dispatch — the alternative (drop the
        // event) would silently lose customer messages.
        onError?.(err, event);
      }
    }

    // 3. Auto-ack + optional typing indicator. Fire-and-forget
    //    so a slow ack never delays enqueue and a failed ack
    //    never blocks the message reaching the agent.
    if (autoMarkRead) {
      void client
        .markAsRead({
          messageId: event.id,
          ...(autoTyping ? { typing: true } : {}),
        })
        .catch((err: unknown) => {
          // Surface but never rethrow — the ack is best-effort
          // UX glue, not a critical-path call.
          onError?.(err, event);
        });
    }

    // 4. Transform — null is a valid "skip this event" signal.
    let task: AgentTask | null;
    try {
      task = transform !== undefined ? transform(event) : defaultAgentTransform(event);
    } catch (err) {
      // A throwing transform is a programmer error in the
      // consumer's code; surface it via onError and drop the
      // event. We do NOT re-throw — the receiver dispatches
      // multiple handlers and an unhandled throw here can mask
      // others.
      onError?.(err, event);
      return;
    }
    if (task === null) return;

    // Late-stamp windowOpen so the value reflects the
    // post-notifyInbound state. Cheap; the storage is local.
    if (windowTracker !== undefined && task.windowOpen === undefined) {
      try {
        task = { ...task, windowOpen: await windowTracker.isWindowOpen(event.from) };
      } catch {
        // Defensive: a storage hiccup here shouldn't block the
        // enqueue. Leave windowOpen undefined.
      }
    }

    // 5. Enqueue. Errors route through onError and are swallowed.
    //    Re-throwing here would surface through the receiver's
    //    Promise.allSettled boundary and risk corrupting the 30 s
    //    ack contract on slow inboxes.
    try {
      await inbox.append(task);
    } catch (err) {
      onError?.(err, event);
    }
  };

  receiver.on("message", handler);

  let disposed = false;
  return {
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      receiver.off("message", handler);
    },
  };
}
