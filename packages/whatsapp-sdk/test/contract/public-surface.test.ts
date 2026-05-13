import { describe, expect, it } from "vitest";

import * as expressEntry from "../../src/adapters/express/index.js";
import * as honoEntry from "../../src/adapters/hono/index.js";
import * as webEntry from "../../src/adapters/web/index.js";
import * as root from "../../src/index.js";
import * as postgresEntry from "../../src/storage/postgres.js";
import * as redisEntry from "../../src/storage/redis.js";

/**
 * Drift detector for the public surface. Every value/class/factory
 * the SDK ships under a subpath export is enumerated here and the
 * test asserts the symbol exists. If a sub-module export gets added
 * without being plumbed through to the consumer-visible entry — or
 * worse, if a documented export is accidentally renamed/removed —
 * this test breaks BEFORE consumers do.
 *
 * Documented additions belong in the list below. Pure-type exports
 * are intentionally NOT enumerated (TypeScript doesn't materialize
 * them at runtime); the type surface is checked by tsc in CI.
 */

const ROOT_VALUE_EXPORTS = [
  // Client
  "WhatsAppClient",
  // Retry
  "DEFAULT_RETRY_POLICY",
  "TransientHttpError",
  "classifyRetryReason",
  // Constants
  "GRAPH_API_VERSION",
  "META_GRAPH_BASE_URL",
  "WEBHOOK_ACK_DEADLINE_MS",
  "WEBHOOK_DEDUPE_TTL_MS",
  "WINDOW_TTL_MS",
  // Errors
  "AuthenticationError",
  "CapabilityError",
  "MissingCredentialsError",
  "MockModeError",
  "OptOutError",
  "PermissionError",
  "RateLimitError",
  "TemplateError",
  "WebhookSignatureError",
  "WhatsAppError",
  "WindowClosedError",
  // Message builders
  "buildAudio",
  "buildAuthTemplate",
  "buildCarouselTemplate",
  "buildContacts",
  "buildDocument",
  "buildImage",
  "buildInteractive",
  "buildInteractiveButton",
  "buildInteractiveCtaUrl",
  "buildInteractiveList",
  "buildLocation",
  "buildReaction",
  "buildSticker",
  "buildTemplate",
  "buildText",
  "buildVideo",
  "buildVoice",
  "sendMessage",
  // Mock mode
  "MockWhatsAppClient",
  "pickWhatsAppClient",
  // Opt-in registry
  "InMemoryOptInRegistry",
  // Observability
  "withSpan",
  "hashPhoneNumberId",
  "setRedactSalt",
  "DEFAULT_REDACT_SALT",
  // Queue
  "BucketMap",
  "TokenBucket",
  "withRateLimit",
  // Templates
  "countTemplatePlaceholders",
  "getTemplate",
  "listTemplates",
  "validateTemplateSend",
  // Webhooks
  "InMemoryStorage",
  "WebhookDeduper",
  "WebhookReceiver",
  "computeSignature",
  "parseWebhookPayload",
  "verifyHandshake",
  "verifySignature",
  "verifySignatureOrThrow",
  // Window
  "WindowTracker",
] as const;

describe("public surface — root entry @dojocoding/whatsapp-sdk", () => {
  for (const name of ROOT_VALUE_EXPORTS) {
    it(`exports \`${name}\``, () => {
      const value = (root as Record<string, unknown>)[name];
      expect(value, `Expected the root entry to export \`${name}\``).toBeDefined();
    });
  }

  it("does NOT export any name that begins with an underscore (no internals leak)", () => {
    const leaked = Object.keys(root).filter((k) => k.startsWith("_"));
    expect(leaked).toEqual([]);
  });
});

describe("public surface — @dojocoding/whatsapp/express", () => {
  for (const name of ["createWhatsAppMiddleware"] as const) {
    it(`exports \`${name}\``, () => {
      expect((expressEntry as Record<string, unknown>)[name]).toBeDefined();
    });
  }
});

describe("public surface — @dojocoding/whatsapp/web", () => {
  for (const name of ["createWhatsAppHandler"] as const) {
    it(`exports \`${name}\``, () => {
      expect((webEntry as Record<string, unknown>)[name]).toBeDefined();
    });
  }
});

describe("public surface — @dojocoding/whatsapp/hono", () => {
  for (const name of ["whatsappHandler"] as const) {
    it(`exports \`${name}\``, () => {
      expect((honoEntry as Record<string, unknown>)[name]).toBeDefined();
    });
  }
});

describe("public surface — @dojocoding/whatsapp/storage/redis", () => {
  for (const name of ["createRedisStorage"] as const) {
    it(`exports \`${name}\``, () => {
      expect((redisEntry as Record<string, unknown>)[name]).toBeDefined();
    });
  }
});

describe("public surface — @dojocoding/whatsapp/storage/postgres", () => {
  for (const name of ["createPostgresStorage", "POSTGRES_STORAGE_SCHEMA"] as const) {
    it(`exports \`${name}\``, () => {
      expect((postgresEntry as Record<string, unknown>)[name]).toBeDefined();
    });
  }
});
