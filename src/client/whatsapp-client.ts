import { GRAPH_API_VERSION, type GraphApiVersion } from "../types/constants.js";
import { type CredentialField, MissingCredentialsError } from "../types/errors.js";

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

  /** @internal — exposed for capability slices that need the bearer token (real client lands in Phase 1). */
  public _getBearerToken(): string {
    return this.#token;
  }

  /** @internal — exposed for the webhook receiver capability (Phase 3). */
  public _getAppSecret(): string {
    return this.#appSecret;
  }
}
