import type { WhatsAppLikeClient } from "@dojocoding/whatsapp-sdk";

/**
 * Shared per-tool runtime context. Holds the bound
 * `WhatsAppLikeClient` instance plus the phone-number-id this
 * server was started against. The interface (not the concrete
 * `WhatsAppClient` class) lets tests pass `MockWhatsAppClient`
 * verbatim. Every send tool stamps the `wabaPhoneNumberId` into
 * its `structuredContent` so the LLM always knows which WABA it
 * just acted on.
 */
export interface ServerContext {
  client: WhatsAppLikeClient;
  wabaPhoneNumberId: string;
}

/** Pulls the first `messages[].id` out of an SDK send response. */
export function extractMessageId(response: { messages: ReadonlyArray<{ id: string }> }): string {
  const id = response.messages[0]?.id;
  if (!id) {
    // Defensive: Meta has always returned at least one message id on
    // a 2xx send. If this ever fires, the response shape changed
    // and the SDK + this file both need to be revisited.
    throw new Error("Meta returned a 2xx send response with no message id");
  }
  return id;
}
