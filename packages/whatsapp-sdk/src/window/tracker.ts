import type { Storage } from "../storage/index.js";
import { WINDOW_TTL_MS } from "../types/constants.js";

export interface WindowTrackerOptions {
  /** The phone number id this tracker scopes its keys to. */
  phoneNumberId: string;
  /** Async key/value store. Use `InMemoryStorage` for dev, BYO Redis for prod. */
  storage: Storage;
  /** Window TTL in milliseconds. Defaults to {@link WINDOW_TTL_MS} (24h). */
  ttlMs?: number;
}

/**
 * 24-hour customer-service-window tracker. Records the most recent inbound
 * timestamp per `customerWaId`, scoped to a single `phoneNumberId`, and
 * exposes `isWindowOpen` for pre-flight checks on outbound free-form
 * sends.
 *
 * Wire it from your inbound handler, passing the customer's timestamp so
 * late webhook deliveries don't re-open a window Meta already closed:
 *   receiver.on("message", (e) => tracker.notifyInbound(e.from, e.timestamp));
 *
 * And from your outbound client:
 *   const client = new WhatsAppClient({ ..., windowTracker: tracker });
 */
export class WindowTracker {
  public readonly phoneNumberId: string;
  readonly #storage: Storage;
  readonly #ttlMs: number;

  constructor(options: WindowTrackerOptions) {
    this.phoneNumberId = options.phoneNumberId;
    this.#storage = options.storage;
    this.#ttlMs = options.ttlMs ?? WINDOW_TTL_MS;
  }

  public get ttlMs(): number {
    return this.#ttlMs;
  }

  /**
   * Record an inbound customer message and (re)open the 24 h window.
   *
   * `atMs` is the customer's message timestamp (epoch ms — pass
   * `MessageEvent.timestamp`). It matters because Meta retries webhook
   * deliveries with backoff for up to 7 days: a late first delivery or
   * a queue replay must open the window from when the customer wrote,
   * not from when the bytes arrived. Rules:
   *
   * - `atMs` defaults to `Date.now()`.
   * - If `atMs` is already `ttlMs` or more in the past, the call is a
   *   no-op — the window it describes has closed, and Meta would reject
   *   a free-form send with `131047`.
   * - If a newer inbound is already recorded, an older `atMs` never
   *   shortens the live window.
   * - The stored value is the inbound timestamp; the storage TTL is the
   *   *remaining* window (`ttlMs - (now - atMs)`), so backends that
   *   evict on TTL and backends that don't agree on the boundary.
   */
  public async notifyInbound(customerWaId: string, atMs?: number): Promise<void> {
    const now = Date.now();
    const inboundAt = atMs ?? now;
    const remainingMs = this.#ttlMs - (now - inboundAt);
    if (remainingMs <= 0) return;

    const key = this.#key(customerWaId);
    const existing = await this.#storage.get<number | true>(key);
    if (typeof existing === "number" && existing >= inboundAt) return;

    // Clamp future-dated timestamps (clock skew) to `now` so a bad clock
    // can't manufacture a window longer than `ttlMs`.
    const recordedAt = Math.min(inboundAt, now);
    await this.#storage.set(key, recordedAt, Math.min(remainingMs, this.#ttlMs));
  }

  public async isWindowOpen(customerWaId: string): Promise<boolean> {
    const seen = await this.#storage.get<number | true>(this.#key(customerWaId));
    // `true` is the pre-0.10 value shape; treat a live legacy entry as open
    // so a rolling upgrade doesn't close every window at once.
    if (seen === true) return true;
    if (typeof seen !== "number") return false;
    return Date.now() - seen < this.#ttlMs;
  }

  /** @internal — exposed so consumers can clear a window after a hard error. */
  public clear(customerWaId: string): Promise<void> {
    return this.#storage.delete(this.#key(customerWaId));
  }

  #key(customerWaId: string): string {
    return `window:${this.phoneNumberId}:${customerWaId}`;
  }
}
