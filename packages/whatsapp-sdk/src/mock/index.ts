// Capability: mock-mode (Phase 6). MockWhatsAppClient parity-tested with
// the real client; in-memory log; simulated webhook delivery.

export { MockWhatsAppClient } from "./client.js";
export { pickWhatsAppClient, type PickWhatsAppClientOptions } from "./factory.js";
export type { MockWhatsAppClientOptions, RecordedSend, WhatsAppLikeClient } from "./types.js";
