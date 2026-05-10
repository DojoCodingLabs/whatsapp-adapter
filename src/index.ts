export { WhatsAppClient } from "./client/whatsapp-client.js";
export type { WhatsAppClientOptions } from "./client/whatsapp-client.js";

export {
  GRAPH_API_VERSION,
  META_GRAPH_BASE_URL,
  WEBHOOK_ACK_DEADLINE_MS,
  WINDOW_TTL_MS,
} from "./types/constants.js";
export type { GraphApiVersion } from "./types/constants.js";

export {
  MissingCredentialsError,
  MockModeError,
  RateLimitError,
  TemplateError,
  WebhookSignatureError,
  WhatsAppError,
  WindowClosedError,
} from "./types/errors.js";
export type {
  CredentialField,
  RateLimitErrorMeta,
  WhatsAppErrorCode,
  WhatsAppErrorOptions,
} from "./types/errors.js";
