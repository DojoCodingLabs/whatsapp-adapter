export { WhatsAppClient } from "./client/whatsapp-client.js";
export type { WhatsAppClientOptions } from "./client/whatsapp-client.js";

export type { TokenInfo } from "./client/health.js";
export type { HttpMethod, RequestOptions } from "./client/transport.js";
export { DEFAULT_RETRY_POLICY, type RetryPolicy, TransientHttpError } from "./client/retry.js";

export {
  GRAPH_API_VERSION,
  META_GRAPH_BASE_URL,
  WEBHOOK_ACK_DEADLINE_MS,
  WEBHOOK_DEDUPE_TTL_MS,
  WINDOW_TTL_MS,
} from "./types/constants.js";
export type { GraphApiVersion } from "./types/constants.js";

export * from "./messages/index.js";
export * from "./webhooks/index.js";
export * from "./window/index.js";

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
