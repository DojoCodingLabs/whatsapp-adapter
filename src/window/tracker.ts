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
 * Wire it from your inbound handler:
 *   receiver.on("message", (e) => tracker.notifyInbound(e.from));
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

  public notifyInbound(customerWaId: string, _atMs?: number): Promise<void> {
    // `atMs` is accepted for API symmetry with future Storage backends that
    // honour caller-supplied timestamps. The default `Storage` impl uses its
    // own clock (now()), so the value is informational here — but exposing
    // the parameter today means we don't have to widen the API later.
    return this.#storage.set(this.#key(customerWaId), true, this.#ttlMs);
  }

  public async isWindowOpen(customerWaId: string): Promise<boolean> {
    const seen = await this.#storage.get<true>(this.#key(customerWaId));
    return seen === true;
  }

  /** @internal — exposed so consumers can clear a window after a hard error. */
  public clear(customerWaId: string): Promise<void> {
    return this.#storage.delete(this.#key(customerWaId));
  }

  #key(customerWaId: string): string {
    return `window:${this.phoneNumberId}:${customerWaId}`;
  }
}
