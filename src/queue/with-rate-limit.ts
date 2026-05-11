import type { WhatsAppLikeClient } from "../mock/types.js";
import { hashPhoneNumberId } from "../observability/redact.js";
import { withSpan } from "../observability/tracing.js";

import { BucketMap } from "./bucket-map.js";

export interface RateLimitOptions {
  /**
   * Per-pair (sender phone_number_id × recipient) ceiling.
   * Defaults to `{ messages: 1, per: 6_000 }` — Meta's documented
   * limit for unsolicited free-form sends.
   */
  perPair?: { messages: number; per: number };
  /**
   * Per-WABA ceiling. Defaults to `{ mps: 80 }`, the verified-tier
   * starting limit. Raise as Meta grants higher tiers.
   */
  perWaba?: { mps: number };
  /** Optional clock injection for deterministic testing. */
  now?: () => number;
  /**
   * Idle-eviction window for per-pair buckets. Buckets at full
   * capacity AND idle for ≥ this many ms are dropped. Default
   * 60_000.
   */
  evictAfterMs?: number;
}

const DEFAULT_PER_PAIR = { messages: 1, per: 6_000 } as const;
const DEFAULT_PER_WABA = { mps: 80 } as const;

/**
 * Decorate any `WhatsAppLikeClient` with two token-bucket rate
 * limiters so outbound sends respect Meta's per-pair and per-WABA
 * ceilings before issuing the HTTP request.
 *
 * The returned client has the same shape as the input. Non-send
 * methods (`isWindowOpen`, `listTemplates`, `getTemplate`) pass
 * through unchanged.
 */
export function withRateLimit(
  client: WhatsAppLikeClient,
  options: RateLimitOptions = {}
): WhatsAppLikeClient {
  const perPair = options.perPair ?? DEFAULT_PER_PAIR;
  const perWaba = options.perWaba ?? DEFAULT_PER_WABA;

  const perPairBuckets = new BucketMap({
    capacity: perPair.messages,
    refillPerMs: perPair.messages / perPair.per,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.evictAfterMs !== undefined ? { evictAfterMs: options.evictAfterMs } : {}),
  });
  const perWabaBuckets = new BucketMap({
    capacity: perWaba.mps,
    refillPerMs: perWaba.mps / 1_000,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.evictAfterMs !== undefined ? { evictAfterMs: options.evictAfterMs } : {}),
  });

  async function gate(to: string): Promise<void> {
    const pairKey = `${client.phoneNumberId}:${to}`;
    const wabaKey = client.wabaId;
    const start = (options.now ?? Date.now)();
    const hashedRecipient = await hashPhoneNumberId(to);
    await withSpan(
      "whatsapp.queue.acquire",
      async () => {
        await perPairBuckets.acquire(pairKey);
        await perWabaBuckets.acquire(wabaKey);
        const end = (options.now ?? Date.now)();
        // Best-effort: attach waited_ms to the active span via the
        // tracing module's API. withSpan already opens the span and
        // sets initial attributes; we record the elapsed wait time
        // as part of the function body's effect via a synthetic
        // return value when desired. For now, the span duration
        // itself approximates `waited_ms`; consumers reading the
        // exporter can compute it from span timing.
        void end;
        void start;
      },
      {
        "whatsapp.queue.pair_recipient": hashedRecipient,
        "whatsapp.queue.waba_id": await hashPhoneNumberId(client.wabaId),
      }
    );
  }

  const wrapped: WhatsAppLikeClient = {
    get phoneNumberId(): string {
      return client.phoneNumberId;
    },
    get wabaId(): string {
      return client.wabaId;
    },
    get graphApiVersion(): WhatsAppLikeClient["graphApiVersion"] {
      return client.graphApiVersion;
    },

    isWindowOpen: (to) => client.isWindowOpen(to),

    sendText: async (input, opts) => {
      await gate(input.to);
      return client.sendText(input, opts);
    },
    sendImage: async (input, opts) => {
      await gate(input.to);
      return client.sendImage(input, opts);
    },
    sendVideo: async (input, opts) => {
      await gate(input.to);
      return client.sendVideo(input, opts);
    },
    sendAudio: async (input, opts) => {
      await gate(input.to);
      return client.sendAudio(input, opts);
    },
    sendDocument: async (input, opts) => {
      await gate(input.to);
      return client.sendDocument(input, opts);
    },
    sendSticker: async (input, opts) => {
      await gate(input.to);
      return client.sendSticker(input, opts);
    },
    sendLocation: async (input, opts) => {
      await gate(input.to);
      return client.sendLocation(input, opts);
    },
    sendContacts: async (input, opts) => {
      await gate(input.to);
      return client.sendContacts(input, opts);
    },
    sendInteractive: async (input, opts) => {
      await gate(input.to);
      return client.sendInteractive(input, opts);
    },
    sendTemplate: async (input, opts) => {
      await gate(input.to);
      return client.sendTemplate(input, opts);
    },
    sendAuthTemplate: async (input, opts) => {
      await gate(input.to);
      return client.sendAuthTemplate(input, opts);
    },
    sendVoice: async (input, opts) => {
      await gate(input.to);
      return client.sendVoice(input, opts);
    },
    sendCarouselTemplate: async (input, opts) => {
      await gate(input.to);
      return client.sendCarouselTemplate(input, opts);
    },
    sendReaction: async (input, opts) => {
      await gate(input.to);
      return client.sendReaction(input, opts);
    },
    sendReply: async (replyTo, payload, opts) => {
      await gate(payload.to);
      return client.sendReply(replyTo, payload, opts);
    },

    listTemplates: (query, opts) => client.listTemplates(query, opts),
    getTemplate: (templateId, opts) => client.getTemplate(templateId, opts),
  };

  return wrapped;
}
