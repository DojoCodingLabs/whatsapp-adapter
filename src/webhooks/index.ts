// Capability: webhook-receiver (Phase 3). Handshake, raw-body HMAC verify,
// polymorphic event parsing, dedupe, dispatch.

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
  WhatsAppEvent,
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

export { computeSignature, verifySignature, type VerifySignatureInput } from "./signature.js";

export { InMemoryStorage, type Storage } from "../storage/index.js";
