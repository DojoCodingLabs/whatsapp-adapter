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
}
