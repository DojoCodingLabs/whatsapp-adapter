import type { Storage } from "../storage/index.js";
import { WEBHOOK_DEDUPE_TTL_MS } from "../types/constants.js";

/**
 * Tracks which webhook events have been seen and returns whether the
 * current sighting is new. Backed by any `Storage` impl (in-memory,
 * Redis, etc.).
 *
 * The key for a `message` event is the wamid; for a `status` event the
 * receiver layers in the status string so transitions (sent → delivered
 * → read → failed) are not collapsed.
 */
export class WebhookDeduper {
  readonly #storage: Storage;
  readonly #ttlMs: number;

  constructor(storage: Storage, ttlMs: number = WEBHOOK_DEDUPE_TTL_MS) {
    this.#storage = storage;
    this.#ttlMs = ttlMs;
  }

  public markIfNew(eventKey: string): Promise<boolean> {
    return this.#storage.setIfAbsent(eventKey, true, this.#ttlMs);
  }
}
