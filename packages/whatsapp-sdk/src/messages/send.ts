import type { RequestOptions } from "../client/transport.js";
import type { WhatsAppClient } from "../client/whatsapp-client.js";

import type { MessageSendResponse, WhatsAppMessage } from "./types.js";

/**
 * POST a fully-built `WhatsAppMessage` payload to `/{phoneNumberId}/messages`.
 * Returns the parsed response body (`{ messaging_product, contacts, messages }`).
 */
export function sendMessage(
  client: WhatsAppClient,
  payload: WhatsAppMessage,
  options?: RequestOptions
): Promise<MessageSendResponse> {
  const path = `/${client.phoneNumberId}/messages`;
  return client.request<MessageSendResponse>("POST", path, payload, options);
}
