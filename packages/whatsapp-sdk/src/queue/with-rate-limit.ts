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
   * Per business phone number throughput ceiling. Meta's default is
   * "up to 80 mps per registered business phone number", counting
   * inbound AND outbound messages; numbers upgraded by Meta get up to
   * 1,000 mps, and Coexistence (WhatsApp Business app) numbers are
   * fixed at 20 mps. Defaults to `{ mps: 80 }`. Lower it to leave
   * headroom for inbound traffic on busy numbers; raise it when Meta
   * upgrades the number. The bucket is keyed by the wrapped client's
   * `phoneNumberId`.
   */
  perPhone?: { mps: number };
  /**
   * @deprecated Meta's throughput limit is
   * per business phone number, not per WABA — use `perPhone`. Still
   * honoured when `perPhone` is absent; ignored when both are set.
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
const DEFAULT_PER_PHONE = { mps: 80 } as const;

/**
 * Decorate any `WhatsAppLikeClient` with two token-bucket rate
 * limiters so outbound sends respect Meta's per-pair and
 * per-business-phone-number ceilings before issuing the HTTP request.
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
  const perPhone = options.perPhone ?? options.perWaba ?? DEFAULT_PER_PHONE;

  const perPairBuckets = new BucketMap({
    capacity: perPair.messages,
    refillPerMs: perPair.messages / perPair.per,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.evictAfterMs !== undefined ? { evictAfterMs: options.evictAfterMs } : {}),
  });
  const perPhoneBuckets = new BucketMap({
    capacity: perPhone.mps,
    refillPerMs: perPhone.mps / 1_000,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.evictAfterMs !== undefined ? { evictAfterMs: options.evictAfterMs } : {}),
  });

  async function gate(to: string): Promise<void> {
    const pairKey = `${client.phoneNumberId}:${to}`;
    const phoneKey = client.phoneNumberId;
    const start = (options.now ?? Date.now)();
    const salt = client.redactSalt;
    const hashedRecipient = await hashPhoneNumberId(to, salt);
    await withSpan(
      "whatsapp.queue.acquire",
      async () => {
        await perPairBuckets.acquire(pairKey);
        await perPhoneBuckets.acquire(phoneKey);
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
        "whatsapp.queue.waba_id": await hashPhoneNumberId(client.wabaId, salt),
        "whatsapp.queue.phone_number_id": await hashPhoneNumberId(client.phoneNumberId, salt),
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

    // markAsRead is a lightweight ack and intentionally NOT rate-gated:
    // - the Cloud API does not count read receipts against MPS quota
    // - gating it would delay the visible "blue tick" the customer sees,
    //   which is the entire UX win the call exists for.
    markAsRead: (input, opts) => client.markAsRead(input, opts),

    // Media upload/download hit Meta's /media endpoints, which are
    // rate-limited separately from /messages and not by recipient.
    // Pass them through; consumers who want to throttle here can
    // wrap with a secondary policy gate.
    uploadMedia: (input, opts) => client.uploadMedia(input, opts),
    downloadMedia: (mediaId, opts) => client.downloadMedia(mediaId, opts),
  };

  return wrapped;
}
