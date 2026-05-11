import { TokenBucket, type TokenBucketOptions } from "./token-bucket.js";

export interface BucketMapOptions extends TokenBucketOptions {
  /**
   * Buckets at full capacity AND idle for at least this many
   * milliseconds are evicted opportunistically on the next
   * `acquire`. Defaults to 60_000 (1 minute).
   */
  evictAfterMs?: number;
}

/**
 * Lazily-created map of `TokenBucket`s, keyed by an arbitrary
 * string. Buckets that have been full and idle for `evictAfterMs`
 * are dropped on the next `acquire` sweep so the map doesn't grow
 * unbounded under fanout workloads.
 *
 * No background timer is scheduled; eviction is opportunistic.
 */
export class BucketMap {
  readonly #factory: () => TokenBucket;
  readonly #now: () => number;
  readonly #evictAfterMs: number;
  readonly #buckets = new Map<string, TokenBucket>();

  constructor(options: BucketMapOptions) {
    const evictAfterMs = options.evictAfterMs ?? 60_000;
    if (!Number.isFinite(evictAfterMs) || evictAfterMs <= 0) {
      throw new RangeError("BucketMap: evictAfterMs must be a positive finite number.");
    }
    this.#evictAfterMs = evictAfterMs;
    this.#now = options.now ?? Date.now;
    this.#factory = (): TokenBucket =>
      new TokenBucket({
        capacity: options.capacity,
        refillPerMs: options.refillPerMs,
        ...(options.now !== undefined ? { now: options.now } : {}),
      });
  }

  public acquire(key: string, count = 1): Promise<void> {
    this.#evictStale();
    let bucket = this.#buckets.get(key);
    if (bucket === undefined) {
      bucket = this.#factory();
      this.#buckets.set(key, bucket);
    }
    return bucket.acquire(count);
  }

  public size(): number {
    return this.#buckets.size;
  }

  #evictStale(): void {
    const cutoff = this.#now() - this.#evictAfterMs;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.isFull() && bucket.lastAccessAt() < cutoff) {
        this.#buckets.delete(key);
      }
    }
  }
}
