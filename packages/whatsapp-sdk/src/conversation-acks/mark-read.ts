import type { RequestOptions } from "../client/transport.js";
import type { WhatsAppClient } from "../client/whatsapp-client.js";

/**
 * Request shape for {@link sendMarkRead} / `WhatsAppClient.markAsRead`.
 */
export interface MarkReadInput {
  /**
   * Inbound message wamid to acknowledge. Comes from a
   * `MessageEvent.id` on the webhook side; reusing an already-read
   * wamid is a no-op on Meta's side (Cloud API is idempotent for
   * read receipts).
   */
  messageId: string;
  /**
   * When `true`, also display a typing indicator to the recipient.
   * Meta couples typing indicators to read receipts: the indicator
   * is only delivered when paired with `status: "read"`, and
   * auto-dismisses when you send a reply or after ~25 seconds.
   *
   * Wire shape (Meta): `typing_indicator: { type: "text" }`.
   */
  typing?: boolean;
}

/**
 * Wire payload posted to `/{phone-number-id}/messages`. Exposed
 * separately so the `withRateLimit` decorator and policy wrappers
 * can re-use the same builder.
 */
interface MarkReadWirePayload {
  messaging_product: "whatsapp";
  status: "read";
  message_id: string;
  typing_indicator?: { type: "text" };
}

/**
 * Build the wire payload for a mark-as-read request. Pure helper —
 * no I/O, no SDK state. Used by both the real client and the mock.
 */
export function buildMarkReadPayload(input: MarkReadInput): MarkReadWirePayload {
  if (typeof input.messageId !== "string" || input.messageId.length === 0) {
    throw new TypeError("markAsRead: `messageId` must be a non-empty wamid string.");
  }
  const payload: MarkReadWirePayload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: input.messageId,
  };
  if (input.typing === true) {
    payload.typing_indicator = { type: "text" };
  }
  return payload;
}

/**
 * Meta's `POST /{phone-number-id}/messages` response for a
 * mark-as-read request — `{ success: true }`. Surfaced verbatim so
 * consumers can branch on the success flag in retries.
 */
export interface MarkReadResponse {
  success: boolean;
}

/**
 * Issue a mark-as-read (and optional typing-indicator) request
 * against Meta's Cloud API. Distinct from a message send: the same
 * `/messages` endpoint is reused but with a `status: "read"` body.
 *
 * Window-independent — mark-as-read does NOT consume the 24-hour
 * customer-service window, and the SDK never pre-flights the
 * tracker on this path. (Meta's docs are unambiguous: read
 * receipts and typing indicators on inbound messages are always
 * allowed; the gate is on outbound free-form sends only.)
 */
export function sendMarkRead(
  client: WhatsAppClient,
  input: MarkReadInput,
  options?: RequestOptions
): Promise<MarkReadResponse> {
  const path = `/${client.phoneNumberId}/messages`;
  return client.request<MarkReadResponse>("POST", path, buildMarkReadPayload(input), options);
}
