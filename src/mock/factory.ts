import { WhatsAppClient, type WhatsAppClientOptions } from "../client/whatsapp-client.js";
import type { TemplateDefinition } from "../templates/types.js";

import { MockWhatsAppClient } from "./client.js";
import type { WhatsAppLikeClient } from "./types.js";

export interface PickWhatsAppClientOptions extends WhatsAppClientOptions {
  /** Force the real client even when WHATSAPP_MODE=mock is set. */
  forceReal?: boolean;
  /** Force the mock client regardless of env. */
  forceMock?: boolean;
  /**
   * Optional template registry — only used when the factory routes to the
   * mock backend. Forwarded to `MockWhatsAppClient` as `options.templates`.
   * Ignored by the real client.
   */
  templates?: ReadonlyArray<TemplateDefinition>;
}

/**
 * Choose between the real `WhatsAppClient` and `MockWhatsAppClient`
 * based on `process.env.WHATSAPP_MODE`. Optional `forceReal` /
 * `forceMock` overrides take precedence over env detection.
 *
 * Returns the shared `WhatsAppLikeClient` interface so consumer code
 * runs uniformly against either implementation.
 */
export function pickWhatsAppClient(options: PickWhatsAppClientOptions): WhatsAppLikeClient {
  if (options.forceMock === true) {
    return makeMock(options);
  }
  if (options.forceReal === true) {
    return new WhatsAppClient(options);
  }
  if (typeof process !== "undefined" && process.env?.["WHATSAPP_MODE"] === "mock") {
    return makeMock(options);
  }
  return new WhatsAppClient(options);
}

function makeMock(options: PickWhatsAppClientOptions): MockWhatsAppClient {
  const mockOpts: ConstructorParameters<typeof MockWhatsAppClient>[0] = {
    phoneNumberId: options.phoneNumberId,
    wabaId: options.wabaId,
  };
  if (options.graphApiVersion !== undefined) mockOpts.graphApiVersion = options.graphApiVersion;
  if (options.windowTracker !== undefined) mockOpts.windowTracker = options.windowTracker;
  if (options.templates !== undefined) mockOpts.templates = options.templates;
  return new MockWhatsAppClient(mockOpts);
}
