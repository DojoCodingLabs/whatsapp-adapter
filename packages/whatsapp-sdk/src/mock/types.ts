import type { TokenInfo } from "../client/health.js";
import type { RequestOptions } from "../client/transport.js";
import type {
  BuildAuthTemplateInput,
  BuildCarouselTemplateInput,
  BuildContactsInput,
  BuildInteractiveInput,
  BuildLocationInput,
  BuildMediaInput,
  BuildReactionInput,
  BuildTemplateInput,
  BuildTextInput,
  BuildVoiceInput,
} from "../messages/builders.js";
import type { MessageSendResponse, WhatsAppMessage } from "../messages/types.js";
import type {
  ListTemplatesQuery,
  ListTemplatesResponse,
  TemplateDefinition,
} from "../templates/types.js";
export type { TemplateDefinition } from "../templates/types.js";
import type { GraphApiVersion } from "../types/constants.js";
import type { WindowTracker } from "../window/tracker.js";

/**
 * Shared interface satisfied by both `WhatsAppClient` and
 * `MockWhatsAppClient`. Consumer code that only needs send capability
 * can take this union and run uniformly against either backend.
 */
export interface WhatsAppLikeClient {
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly graphApiVersion: GraphApiVersion;

  isWindowOpen(to: string): Promise<boolean>;

  sendText(input: BuildTextInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendImage(input: BuildMediaInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendVideo(input: BuildMediaInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendAudio(input: BuildMediaInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendDocument(input: BuildMediaInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendSticker(input: BuildMediaInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendLocation(input: BuildLocationInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendContacts(input: BuildContactsInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendInteractive(
    input: BuildInteractiveInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse>;
  sendTemplate(input: BuildTemplateInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendAuthTemplate(
    input: BuildAuthTemplateInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse>;
  sendVoice(input: BuildVoiceInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendCarouselTemplate(
    input: BuildCarouselTemplateInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse>;
  sendReaction(input: BuildReactionInput, options?: RequestOptions): Promise<MessageSendResponse>;
  sendReply(
    replyTo: string,
    payload: WhatsAppMessage,
    options?: RequestOptions
  ): Promise<MessageSendResponse>;

  listTemplates(
    query?: ListTemplatesQuery,
    options?: RequestOptions
  ): Promise<ListTemplatesResponse>;
  getTemplate(templateId: string, options?: RequestOptions): Promise<TemplateDefinition>;

  /**
   * Operational token-introspection check. Optional on the interface so
   * minimal wrappers don't have to stub it, but every shipped implementation
   * (real client + mock) provides it. Consumers wrapping `WhatsAppLikeClient`
   * for policy gating (consent, audit, rate-limit) typically delegate this
   * to the inner client.
   */
  healthCheck?(options?: RequestOptions): Promise<TokenInfo>;
}

/** A single send recorded by the mock client. */
export interface RecordedSend {
  wamid: string;
  payload: WhatsAppMessage;
  sentAt: number;
}

export interface MockWhatsAppClientOptions {
  phoneNumberId: string;
  wabaId: string;
  graphApiVersion?: GraphApiVersion;
  windowTracker?: WindowTracker;
  /** Optional clock injection (defaults to Date.now). */
  now?: () => number;
  /**
   * Optional template registry. When supplied, `listTemplates(query?)`
   * filters the seed in memory and `getTemplate(id)` resolves with the
   * matching entry. When omitted, the mock preserves the v1 behaviour:
   * `listTemplates` → `{ data: [] }` and `getTemplate` rejects.
   */
  templates?: ReadonlyArray<TemplateDefinition>;
}
