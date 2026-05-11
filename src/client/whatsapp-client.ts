import {
  buildAudio,
  buildAuthTemplate,
  type BuildAuthTemplateInput,
  buildCarouselTemplate,
  type BuildCarouselTemplateInput,
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
  buildVoice,
  type BuildVoiceInput,
} from "../messages/builders.js";
import { sendMessage } from "../messages/send.js";
import type { MessageSendResponse, WhatsAppMessage } from "../messages/types.js";
import { getTemplate, listTemplates } from "../templates/api.js";
import type {
  ListTemplatesQuery,
  ListTemplatesResponse,
  TemplateDefinition,
} from "../templates/types.js";
import { GRAPH_API_VERSION, type GraphApiVersion } from "../types/constants.js";
import {
  AuthenticationError,
  type CredentialField,
  MissingCredentialsError,
  WindowClosedError,
} from "../types/errors.js";
import type { WindowTracker } from "../window/tracker.js";

import { healthCheck, type TokenInfo } from "./health.js";
import { type HttpMethod, request, type RequestOptions } from "./transport.js";

/**
 * Resolves the bearer token used for Graph API requests. Invoked
 * exactly once per outer `request()` call; the resolved value is used
 * for all retry attempts within that request. Throw, return an empty
 * string, or return a non-string value to surface as `AuthenticationError`
 * before the HTTP request is made.
 *
 * Use this shape when tokens rotate (System User expiry, manual
 * rotation in Business Manager, refresh after a 401). The SDK does
 * NOT cache the resolved value across requests; cache inside your
 * callback if needed.
 */
export type TokenProvider = () => string | Promise<string>;

export interface WhatsAppClientOptions {
  /** Phone number ID for the WhatsApp Business phone (Graph API: /{phone-number-id}/messages). */
  phoneNumberId: string;
  /** WhatsApp Business Account ID (Graph API: /{waba-id}/message_templates). */
  wabaId: string;
  /**
   * Long-lived BISU or System User token, or a `TokenProvider` callback
   * that resolves one per request. Callback shape supports rotation
   * without swapping the client instance.
   */
  token: string | TokenProvider;
  /** App secret used to verify HMAC-SHA256 signatures on inbound webhooks. */
  appSecret: string;
  /** Optional override for the pinned Graph API version (default: GRAPH_API_VERSION). */
  graphApiVersion?: GraphApiVersion;
  /**
   * Optional 24h-window tracker. When provided, free-form sends
   * (sendText, sendMedia*, sendLocation, sendContacts, sendInteractive)
   * pre-flight-check the tracker and throw `WindowClosedError` before
   * issuing any HTTP request. `sendTemplate` and `sendReaction` are
   * window-exempt and never consult the tracker.
   */
  windowTracker?: WindowTracker;
}

const STRING_CREDENTIAL_FIELDS = [
  "phoneNumberId",
  "wabaId",
  "appSecret",
] as const satisfies ReadonlyArray<CredentialField>;

function isValidTokenOption(value: unknown): value is string | TokenProvider {
  if (typeof value === "function") return true;
  return typeof value === "string" && value.length > 0;
}

export class WhatsAppClient {
  public readonly phoneNumberId: string;
  public readonly wabaId: string;
  public readonly graphApiVersion: GraphApiVersion;
  readonly #tokenProvider: TokenProvider;
  readonly #appSecret: string;
  readonly #windowTracker: WindowTracker | undefined;

  constructor(options: WhatsAppClientOptions) {
    const missing: CredentialField[] = STRING_CREDENTIAL_FIELDS.filter((field) => {
      const value = options[field];
      return typeof value !== "string" || value.length === 0;
    });
    if (!isValidTokenOption(options.token)) {
      missing.push("token");
    }
    if (missing.length > 0) {
      throw new MissingCredentialsError(missing);
    }
    this.phoneNumberId = options.phoneNumberId;
    this.wabaId = options.wabaId;
    this.#tokenProvider =
      typeof options.token === "function" ? options.token : (): string => options.token as string;
    this.#appSecret = options.appSecret;
    this.graphApiVersion = options.graphApiVersion ?? GRAPH_API_VERSION;
    this.#windowTracker = options.windowTracker;
  }

  /**
   * Whether the 24h customer-service window is currently open for `to`.
   * Returns `true` when no window tracker is configured (preserving the
   * pre-Phase-4 "ungated" behaviour); otherwise delegates to the tracker.
   */
  public isWindowOpen(to: string): Promise<boolean> {
    if (this.#windowTracker === undefined) return Promise.resolve(true);
    return this.#windowTracker.isWindowOpen(to);
  }

  async #assertWindowOpen(to: string): Promise<void> {
    if (this.#windowTracker === undefined) return;
    const open = await this.#windowTracker.isWindowOpen(to);
    if (!open) {
      throw new WindowClosedError(to);
    }
  }

  /**
   * @internal — exposed for capability slices that need the bearer
   * token. Resolves the configured `TokenProvider` exactly once per
   * call; surfaces provider failures as `AuthenticationError` before
   * the HTTP request is made.
   */
  public async _resolveBearerToken(): Promise<string> {
    let resolved: unknown;
    try {
      resolved = await this.#tokenProvider();
    } catch (err) {
      throw new AuthenticationError(
        "WhatsApp token provider threw an error before the request could be made.",
        {},
        { cause: err }
      );
    }
    if (typeof resolved !== "string") {
      throw new AuthenticationError(
        `WhatsApp token provider returned a non-string value (typeof ${typeof resolved}).`
      );
    }
    if (resolved.length === 0) {
      throw new AuthenticationError("WhatsApp token provider returned an empty string.");
    }
    return resolved;
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

  // ───────────── Convenience send methods ─────────────

  public async sendText(
    input: BuildTextInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return sendMessage(this, buildText(input), options);
  }

  public async sendImage(
    input: BuildMediaInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return sendMessage(this, buildImage(input), options);
  }

  public async sendVideo(
    input: BuildMediaInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return sendMessage(this, buildVideo(input), options);
  }

  public async sendAudio(
    input: BuildMediaInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return sendMessage(this, buildAudio(input), options);
  }

  public async sendDocument(
    input: BuildMediaInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return sendMessage(this, buildDocument(input), options);
  }

  public async sendSticker(
    input: BuildMediaInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return sendMessage(this, buildSticker(input), options);
  }

  public async sendLocation(
    input: BuildLocationInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return sendMessage(this, buildLocation(input), options);
  }

  public async sendContacts(
    input: BuildContactsInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return sendMessage(this, buildContacts(input), options);
  }

  public async sendInteractive(
    input: BuildInteractiveInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return sendMessage(this, buildInteractive(input), options);
  }

  /**
   * Window-exempt: templates are the escape hatch when the window is closed.
   * Async so any synchronous error from `buildTemplate` (e.g.,
   * `validateAgainst` mismatch) surfaces as a rejected promise rather
   * than a synchronous throw.
   */
  public async sendTemplate(
    input: BuildTemplateInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    return sendMessage(this, buildTemplate(input), options);
  }

  /** Window-exempt: authentication templates are the canonical out-of-window send. */
  public async sendAuthTemplate(
    input: BuildAuthTemplateInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    return sendMessage(this, buildAuthTemplate(input), options);
  }

  /**
   * Send a voice note (audio with `voice: true`). Window-gated like
   * any other free-form media send. Voice notes trigger transcription
   * support, auto-download, and a "played" status when the recipient
   * listens.
   */
  public async sendVoice(
    input: BuildVoiceInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    await this.#assertWindowOpen(input.to);
    return sendMessage(this, buildVoice(input), options);
  }

  /** Window-exempt: carousel sends are template sends. */
  public async sendCarouselTemplate(
    input: BuildCarouselTemplateInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    return sendMessage(this, buildCarouselTemplate(input), options);
  }

  // ───────────── Template management (Phase 5) ─────────────

  public listTemplates(
    query?: ListTemplatesQuery,
    options?: RequestOptions
  ): Promise<ListTemplatesResponse> {
    return listTemplates(this, query ?? {}, options);
  }

  public getTemplate(templateId: string, options?: RequestOptions): Promise<TemplateDefinition> {
    return getTemplate(this, templateId, options);
  }

  /** Window-exempt: reactions are part of an existing thread. */
  public sendReaction(
    input: BuildReactionInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    return sendMessage(this, buildReaction(input), options);
  }

  /**
   * Send any pre-built `WhatsAppMessage` payload as a reply to a previous
   * message identified by its wamid. Sets `context.message_id` and posts.
   * Window-gated for non-template, non-reaction payloads.
   */
  public async sendReply(
    replyTo: string,
    payload: WhatsAppMessage,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    if (typeof replyTo !== "string" || replyTo.length === 0) {
      throw new Error("sendReply: `replyTo` must be a non-empty wamid string.");
    }
    if (payload.type !== "template" && payload.type !== "reaction") {
      await this.#assertWindowOpen(payload.to);
    }
    const withContext: WhatsAppMessage = { ...payload, context: { message_id: replyTo } };
    return sendMessage(this, withContext, options);
  }
}
