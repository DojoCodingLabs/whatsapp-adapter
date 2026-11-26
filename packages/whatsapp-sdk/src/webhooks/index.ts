// Capability: webhook-receiver (Phase 3). Handshake, raw-body HMAC verify,
// polymorphic event parsing, dedupe, dispatch.

export {
  messageIdentityChange,
  messageMedia,
  messageReferral,
  messageReplyId,
  messageSenderKey,
  messageText,
  type IdentityChange,
  type InboundMedia,
  type InboundMediaKind,
  type NormalisedReferral,
} from "./accessors.js";

export { WebhookDeduper } from "./dedupe.js";

export type {
  AccountAlertEvent,
  AccountReviewEvent,
  BaseEvent,
  DeliveryStatus,
  IncomingMessageKind,
  MessageEvent,
  PhoneNumberQualityUpdateEvent,
  StatusEvent,
  TemplateCategoryUpdateEvent,
  TemplateQualityUpdateEvent,
  TemplateStatusEvent,
  UnknownEvent,
  UserPreferencesEvent,
  WebhookContact,
  WebhookErrorDetail,
  WebhookErrorEvent,
  WhatsAppEvent,
  WhatsAppReferral,
} from "./events.js";

export { verifyHandshake, type VerifyHandshakeInput } from "./handshake.js";

export { parseWebhookPayload } from "./parser.js";

export {
  WebhookReceiver,
  type ErrorHandler,
  type EventKindMap,
  type Handler,
  type HandlePayloadResult,
  type VerifyRequestInput,
  type VerifyRequestResult,
  type WebhookReceiverOptions,
} from "./receiver.js";

export {
  computeSignature,
  verifySignature,
  verifySignatureOrThrow,
  type VerifySignatureInput,
} from "./signature.js";

export { InMemoryStorage, type Storage } from "../storage/index.js";
