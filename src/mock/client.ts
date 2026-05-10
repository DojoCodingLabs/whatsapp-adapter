import type { RequestOptions } from "../client/transport.js";
import {
  buildAudio,
  buildContacts,
  buildDocument,
  buildImage,
  buildInteractive,
  buildLocation,
  buildReaction,
  buildSticker,
  buildTemplate,
  buildText,
  buildVideo,
  type BuildContactsInput,
  type BuildInteractiveInput,
  type BuildLocationInput,
  type BuildMediaInput,
  type BuildReactionInput,
  type BuildTemplateInput,
  type BuildTextInput,
} from "../messages/builders.js";
import type { MessageSendResponse, WhatsAppMessage } from "../messages/types.js";
import type {
  ListTemplatesQuery,
  ListTemplatesResponse,
  TemplateDefinition,
} from "../templates/types.js";
import { GRAPH_API_VERSION, type GraphApiVersion } from "../types/constants.js";
import { TemplateError, WhatsAppError, WindowClosedError } from "../types/errors.js";
import type { WhatsAppEvent } from "../webhooks/events.js";
import type { WebhookReceiver } from "../webhooks/receiver.js";
import type { WindowTracker } from "../window/tracker.js";

import type { MockWhatsAppClientOptions, RecordedSend, WhatsAppLikeClient } from "./types.js";

/**
 * In-memory implementation of `WhatsAppLikeClient`. Records every send
 * as a `RecordedSend`, generates deterministic `wamid.mock-${counter}`
 * ids, and never touches the network.
 *
 * Honours the same `windowTracker` gate as the real client.
 */
export class MockWhatsAppClient implements WhatsAppLikeClient {
  public readonly phoneNumberId: string;
  public readonly wabaId: string;
  public readonly graphApiVersion: GraphApiVersion;
  readonly #windowTracker: WindowTracker | undefined;
  readonly #now: () => number;
  #sentMessages: RecordedSend[] = [];
  #counter = 0;

  constructor(options: MockWhatsAppClientOptions) {
    this.phoneNumberId = options.phoneNumberId;
    this.wabaId = options.wabaId;
    this.graphApiVersion = options.graphApiVersion ?? GRAPH_API_VERSION;
    this.#windowTracker = options.windowTracker;
    this.#now = options.now ?? Date.now;
  }

  public get sentMessages(): ReadonlyArray<RecordedSend> {
    return this.#sentMessages;
  }

  public reset(): void {
    this.#sentMessages = [];
    this.#counter = 0;
  }

  public isWindowOpen(to: string): Promise<boolean> {
    if (this.#windowTracker === undefined) return Promise.resolve(true);
    return this.#windowTracker.isWindowOpen(to);
  }

  /**
   * Synthesise a webhook event into a `WebhookReceiver`. Bypasses
   * signature verification — the receiver dispatches handlers directly.
   */
  public simulateInbound(receiver: WebhookReceiver, event: WhatsAppEvent): Promise<void> {
    return receiver._dispatchEvents([event]);
  }

  // ───────────── send* (mirror WhatsAppClient) ─────────────

  public async sendText(input: BuildTextInput): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return this.#record(buildText(input));
  }

  public async sendImage(input: BuildMediaInput): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return this.#record(buildImage(input));
  }

  public async sendVideo(input: BuildMediaInput): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return this.#record(buildVideo(input));
  }

  public async sendAudio(input: BuildMediaInput): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return this.#record(buildAudio(input));
  }

  public async sendDocument(input: BuildMediaInput): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return this.#record(buildDocument(input));
  }

  public async sendSticker(input: BuildMediaInput): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return this.#record(buildSticker(input));
  }

  public async sendLocation(input: BuildLocationInput): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return this.#record(buildLocation(input));
  }

  public async sendContacts(input: BuildContactsInput): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return this.#record(buildContacts(input));
  }

  public async sendInteractive(input: BuildInteractiveInput): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return this.#record(buildInteractive(input));
  }

  public sendTemplate(input: BuildTemplateInput): Promise<MessageSendResponse> {
    return Promise.resolve(this.#record(buildTemplate(input)));
  }

  public sendReaction(input: BuildReactionInput): Promise<MessageSendResponse> {
    return Promise.resolve(this.#record(buildReaction(input)));
  }

  public async sendReply(replyTo: string, payload: WhatsAppMessage): Promise<MessageSendResponse> {
    if (typeof replyTo !== "string" || replyTo.length === 0) {
      throw new Error("sendReply: `replyTo` must be a non-empty wamid string.");
    }
    if (payload.type !== "template" && payload.type !== "reaction") {
      await this.#assertWindowOpen(payload.to);
    }
    const withContext: WhatsAppMessage = { ...payload, context: { message_id: replyTo } };
    return this.#record(withContext);
  }

  // ───────────── template management (Phase 5 mirror) ─────────────

  public listTemplates(
    _query?: ListTemplatesQuery,
    _options?: RequestOptions
  ): Promise<ListTemplatesResponse> {
    return Promise.resolve({ data: [] });
  }

  public getTemplate(templateId: string, _options?: RequestOptions): Promise<TemplateDefinition> {
    if (typeof templateId !== "string" || templateId.length === 0) {
      return Promise.reject(new TypeError("getTemplate: templateId must be a non-empty string."));
    }
    return Promise.reject(
      new TemplateError(
        `MockWhatsAppClient does not maintain a template registry; supply WHATSAPP_MODE=real or stub via your test harness.`,
        templateId
      )
    );
  }

  // ───────────── internals ─────────────

  async #assertWindowOpen(to: string): Promise<void> {
    if (this.#windowTracker === undefined) return;
    const open = await this.#windowTracker.isWindowOpen(to);
    if (!open) throw new WindowClosedError(to);
  }

  #record(payload: WhatsAppMessage): MessageSendResponse {
    this.#counter += 1;
    const wamid = `wamid.mock-${this.#counter}`;
    this.#sentMessages.push({ wamid, payload, sentAt: this.#now() });
    return {
      messaging_product: "whatsapp",
      contacts: [{ input: payload.to, wa_id: payload.to }],
      messages: [{ id: wamid }],
    };
  }
}

/**
 * Re-export for symmetry with WhatsAppError-shaped catch sites; the
 * WhatsAppError class is the only "throwable" type the mock surfaces.
 */
export { WhatsAppError };
