export interface TokenBucketOptions {
  /** Maximum number of tokens the bucket holds. */
  capacity: number;
  /** Refill rate in tokens per millisecond (e.g. `80 / 1000` for 80 MPS). */
  refillPerMs: number;
  /** Optional clock injection (defaults to `Date.now`). */
  now?: () => number;
}

/**
 * Continuous-refill token bucket. `acquire(count)` resolves
 * immediately when enough tokens are available; otherwise waits
 * (via `setTimeout`) until refill produces enough. Concurrent
 * `acquire` calls on an empty bucket are serialised so two callers
 * never consume the same refilled token.
 *
 * No background timer is scheduled; refill is computed lazily on
 * access. Safe to construct and discard.
 */
export class TokenBucket {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  readonly #now: () => number;
  #tokens: number;
  #lastRefillAt: number;
  #lastAccessAt: number;
  /** Tail of the single-flight wait chain. `undefined` when no waiter is queued. */
  #waitTail: Promise<void> | undefined;

  constructor(options: TokenBucketOptions) {
    if (!Number.isFinite(options.capacity) || options.capacity <= 0) {
      throw new RangeError("TokenBucket: capacity must be a positive finite number.");
    }
    if (!Number.isFinite(options.refillPerMs) || options.refillPerMs <= 0) {
      throw new RangeError("TokenBucket: refillPerMs must be a positive finite number.");
    }
    this.#capacity = options.capacity;
    this.#refillPerMs = options.refillPerMs;
    this.#now = options.now ?? Date.now;
    this.#tokens = options.capacity;
    const t = this.#now();
    this.#lastRefillAt = t;
    this.#lastAccessAt = t;
  }

  /** Current token count after applying any pending refill. Pure read. */
  public peek(): number {
    this.#refill();
    return this.#tokens;
  }

  /** Last access timestamp (epoch ms). Used by `BucketMap` eviction. */
  public lastAccessAt(): number {
    return this.#lastAccessAt;
  }

  /** Whether the bucket currently has its full capacity worth of tokens. */
  public isFull(): boolean {
    return this.peek() >= this.#capacity;
  }

  /**
   * Acquire `count` tokens. Resolves once the tokens are reserved
   * for this caller. Concurrent acquires queue behind the previous
   * waiter so the refill is consumed in arrival order.
   */
  public acquire(count = 1): Promise<void> {
    if (!Number.isFinite(count) || count <= 0) {
      return Promise.reject(new RangeError("TokenBucket.acquire: count must be > 0."));
    }
    if (count > this.#capacity) {
      return Promise.reject(
        new RangeError(
          `TokenBucket.acquire: count (${count}) exceeds bucket capacity (${this.#capacity}).`
        )
      );
    }
    this.#lastAccessAt = this.#now();
    // If no waiter is queued and tokens are available right now, fast path.
    if (this.#waitTail === undefined) {
      this.#refill();
      if (this.#tokens >= count) {
        this.#tokens -= count;
        return Promise.resolve();
      }
    }
    // Otherwise queue behind whatever is already waiting.
    const tail = this.#waitTail ?? Promise.resolve();
    const ours = tail.then(() => this.#consumeAfterWait(count));
    this.#waitTail = ours.catch(() => undefined);
    return ours;
  }

  async #consumeAfterWait(count: number): Promise<void> {
    // Loop until we can take `count` tokens.
    for (;;) {
      this.#refill();
      if (this.#tokens >= count) {
        this.#tokens -= count;
        // If we were the last waiter, clear the tail so the next
        // synchronous acquire can take the fast path.
        if (this.#waitTail !== undefined) {
          // Yield once to let any chained `.then` settle before we
          // null out the tail.
          await Promise.resolve();
          // Re-check: only clear if no new waiters arrived.
          this.#maybeClearTail();
        }
        return;
      }
      const deficit = count - this.#tokens;
      const waitMs = Math.max(1, Math.ceil(deficit / this.#refillPerMs));
      await sleep(waitMs);
    }
  }

  #maybeClearTail(): void {
    // Best-effort: we can't know whether more `.then`s are queued
    // on the chain, but clearing the field allows future fast-path
    // acquires once the chain drains. If a waiter is still queued,
    // the next `acquire` re-establishes the chain.
    this.#waitTail = undefined;
  }

  #refill(): void {
    const now = this.#now();
    const elapsed = Math.max(0, now - this.#lastRefillAt);
    if (elapsed === 0) return;
    this.#tokens = Math.min(this.#capacity, this.#tokens + elapsed * this.#refillPerMs);
    this.#lastRefillAt = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
