export { WhatsAppClient } from "./client/whatsapp-client.js";
export type { TokenProvider, WhatsAppClientOptions } from "./client/whatsapp-client.js";

export type { TokenInfo } from "./client/health.js";
export type { ExternalFetchOptions, HttpMethod, RequestOptions } from "./client/transport.js";
export {
  classifyRetryReason,
  DEFAULT_RETRY_POLICY,
  type RetryHooks,
  type RetryInfo,
  type RetryPolicy,
  type RetryReason,
  TransientHttpError,
} from "./client/retry.js";

export {
  GRAPH_API_VERSION,
  META_GRAPH_BASE_URL,
  WEBHOOK_ACK_DEADLINE_MS,
  WEBHOOK_DEDUPE_TTL_MS,
  WINDOW_TTL_MS,
} from "./types/constants.js";
export type { GraphApiVersion } from "./types/constants.js";

export * from "./agent-bridge/index.js";
export * from "./conversation-acks/index.js";
export * from "./media/index.js";
export * from "./messages/index.js";
export * from "./mock/index.js";
export * from "./observability/index.js";
export * from "./opt-in/index.js";
export * from "./queue/index.js";
export * from "./templates/index.js";
export * from "./webhooks/index.js";
export * from "./window/index.js";

export {
  AccountRestrictedError,
  AuthenticationError,
  CapabilityError,
  MissingCredentialsError,
  MockModeError,
  NetworkError,
  OptOutError,
  PermissionError,
  RateLimitError,
  MediaExpiredError,
  type MediaExpiredErrorMeta,
  RequestAbortedError,
  TemplateError,
  TransientError,
  UndeliverableError,
  WebhookSignatureError,
  WhatsAppError,
  WindowClosedError,
} from "./types/errors.js";
export type {
  AccountRestrictedErrorMeta,
  AuthenticationErrorMeta,
  CapabilityErrorMeta,
  CredentialField,
  PermissionErrorMeta,
  RateLimitErrorMeta,
  TemplateErrorMeta,
  TransientErrorMeta,
  WhatsAppErrorCode,
  WhatsAppErrorOptions,
} from "./types/errors.js";
