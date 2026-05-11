/**
 * Pluggable async key-value storage with TTL semantics. Implementations
 * MUST honour `ttlMs`: entries past their `expiresAt` SHALL NOT be
 * returned by `get`. Implementations SHOULD NOT spawn background timers;
 * lazy eviction (on access) is preferred so consumers do not leak timers
 * that prevent process exit.
 */
export interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  /**
   * Atomically write `value` for `key` only if no live entry exists.
   * Returns `true` when the value was written, `false` when an unexpired
   * entry was already present. Implementations MUST honour `ttlMs` the
   * same way as `set`.
   */
  setIfAbsent<T>(key: string, value: T, ttlMs: number): Promise<boolean>;
  delete(key: string): Promise<void>;
}

interface InMemoryEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory implementation of {@link Storage}. Backed by a `Map`. TTL is
 * enforced lazily — expired entries are evicted only on access. No
 * background timers are spawned.
 *
 * Suitable for development, tests, and single-process deployments. For
 * multi-process or cross-instance dedupe, implement `Storage` against
 * Redis / Postgres / your shared cache.
 */
export class InMemoryStorage implements Storage {
  readonly #map = new Map<string, InMemoryEntry<unknown>>();
  readonly #now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  public get<T>(key: string): Promise<T | undefined> {
    const entry = this.#map.get(key);
    if (entry === undefined) {
      return Promise.resolve(undefined);
    }
    if (this.#now() >= entry.expiresAt) {
      this.#map.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.value as T);
  }

  public set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const expiresAt = ttlMs <= 0 ? Number.POSITIVE_INFINITY : this.#now() + ttlMs;
    this.#map.set(key, { value, expiresAt });
    return Promise.resolve();
  }

  public setIfAbsent<T>(key: string, value: T, ttlMs: number): Promise<boolean> {
    const existing = this.#map.get(key);
    if (existing !== undefined && this.#now() < existing.expiresAt) {
      return Promise.resolve(false);
    }
    const expiresAt = ttlMs <= 0 ? Number.POSITIVE_INFINITY : this.#now() + ttlMs;
    this.#map.set(key, { value, expiresAt });
    return Promise.resolve(true);
  }

  public delete(key: string): Promise<void> {
    this.#map.delete(key);
    return Promise.resolve();
  }

  /** Test-only — returns the current map size (including expired entries). */
  public _rawSize(): number {
    return this.#map.size;
  }
}
