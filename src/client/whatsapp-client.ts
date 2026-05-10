import {
  buildAudio,
  type BuildContactsInput,
  buildContacts,
  buildDocument,
  buildImage,
  buildInteractive,
  type BuildInteractiveInput,
  type BuildLocationInput,
  buildLocation,
  type BuildMediaInput,
  type BuildReactionInput,
  buildReaction,
  buildSticker,
  type BuildTemplateInput,
  buildTemplate,
  type BuildTextInput,
  buildText,
  buildVideo,
} from "../messages/builders.js";
import { sendMessage } from "../messages/send.js";
import type { MessageSendResponse, WhatsAppMessage } from "../messages/types.js";
import { GRAPH_API_VERSION, type GraphApiVersion } from "../types/constants.js";
import { type CredentialField, MissingCredentialsError } from "../types/errors.js";

import { healthCheck, type TokenInfo } from "./health.js";
import { type HttpMethod, request, type RequestOptions } from "./transport.js";

export interface WhatsAppClientOptions {
  /** Phone number ID for the WhatsApp Business phone (Graph API: /{phone-number-id}/messages). */
  phoneNumberId: string;
  /** WhatsApp Business Account ID (Graph API: /{waba-id}/message_templates). */
  wabaId: string;
  /** Long-lived BISU or System User token used as the bearer credential. */
  token: string;
  /** App secret used to verify HMAC-SHA256 signatures on inbound webhooks. */
  appSecret: string;
  /** Optional override for the pinned Graph API version (default: GRAPH_API_VERSION). */
  graphApiVersion?: GraphApiVersion;
}

const REQUIRED_CREDENTIAL_FIELDS = [
  "phoneNumberId",
  "wabaId",
  "token",
  "appSecret",
] as const satisfies ReadonlyArray<CredentialField>;

export class WhatsAppClient {
  public readonly phoneNumberId: string;
  public readonly wabaId: string;
  public readonly graphApiVersion: GraphApiVersion;
  readonly #token: string;
  readonly #appSecret: string;

  constructor(options: WhatsAppClientOptions) {
    const missing = REQUIRED_CREDENTIAL_FIELDS.filter((field) => {
      const value = options[field];
      return typeof value !== "string" || value.length === 0;
    });
    if (missing.length > 0) {
      throw new MissingCredentialsError(missing);
    }
    this.phoneNumberId = options.phoneNumberId;
    this.wabaId = options.wabaId;
    this.#token = options.token;
    this.#appSecret = options.appSecret;
    this.graphApiVersion = options.graphApiVersion ?? GRAPH_API_VERSION;
  }

  /** @internal — exposed for capability slices that need the bearer token. */
  public _getBearerToken(): string {
    return this.#token;
  }

  /** @internal — exposed for the webhook receiver capability (Phase 3). */
  public _getAppSecret(): string {
    return this.#appSecret;
  }

  /**
   * Issue an authenticated Graph API request.
   *
   * @internal — public-API surface for sends, templates, etc. lands in
   * later phases (Phase 2 message-builders, Phase 5 template-management).
   */
  public request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return request<T>(this, method, path, body, options);
  }

  /**
   * Verify the bearer token via Meta's `/debug_token` endpoint.
   *
   * Resolves with the parsed token info; throws `WhatsAppError` if the
   * token is invalid or the call fails.
   */
  public healthCheck(options?: RequestOptions): Promise<TokenInfo> {
    return healthCheck(this, options ?? {});
  }

  // ───────────── Convenience send methods (Phase 2) ─────────────

  public sendText(input: BuildTextInput, options?: RequestOptions): Promise<MessageSendResponse> {
    return sendMessage(this, buildText(input), options);
  }

  public sendImage(input: BuildMediaInput, options?: RequestOptions): Promise<MessageSendResponse> {
    return sendMessage(this, buildImage(input), options);
  }

  public sendVideo(input: BuildMediaInput, options?: RequestOptions): Promise<MessageSendResponse> {
    return sendMessage(this, buildVideo(input), options);
  }

  public sendAudio(input: BuildMediaInput, options?: RequestOptions): Promise<MessageSendResponse> {
    return sendMessage(this, buildAudio(input), options);
  }

  public sendDocument(
    input: BuildMediaInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    return sendMessage(this, buildDocument(input), options);
  }

  public sendSticker(
    input: BuildMediaInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    return sendMessage(this, buildSticker(input), options);
  }

  public sendLocation(
    input: BuildLocationInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    return sendMessage(this, buildLocation(input), options);
  }

  public sendContacts(
    input: BuildContactsInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    return sendMessage(this, buildContacts(input), options);
  }

  public sendInteractive(
    input: BuildInteractiveInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    return sendMessage(this, buildInteractive(input), options);
  }

  public sendTemplate(
    input: BuildTemplateInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    return sendMessage(this, buildTemplate(input), options);
  }

  public sendReaction(
    input: BuildReactionInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    return sendMessage(this, buildReaction(input), options);
  }

  /**
   * Send any pre-built `WhatsAppMessage` payload as a reply to a previous
   * message identified by its wamid. Sets `context.message_id` and posts.
   */
  public sendReply(
    replyTo: string,
    payload: WhatsAppMessage,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    if (typeof replyTo !== "string" || replyTo.length === 0) {
      throw new Error("sendReply: `replyTo` must be a non-empty wamid string.");
    }
    const withContext: WhatsAppMessage = { ...payload, context: { message_id: replyTo } };
    return sendMessage(this, withContext, options);
  }
}
