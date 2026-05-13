/**
 * Consent-state primitive. Mirrors the SDK's `Storage`
 * interface in shape: small, async, pluggable. The default
 * in-memory implementation ships at `./in-memory.js`.
 *
 * Used by `WhatsAppClient` to pre-flight template sends
 * (`sendTemplate`, `sendAuthTemplate`, `sendCarouselTemplate`)
 * against recorded consent state. Free-form sends do NOT
 * consult the registry — they're already gated by the 24h
 * customer-service window, which implies the customer
 * initiated contact.
 *
 * See `docs/sdk/opt-in.md` for the consumer reference and
 * `docs/cookbook/sdk/opt-in-postgres.md` for the canonical
 * Postgres-backed registry recipe.
 */

/**
 * WhatsApp template categories as documented by Meta. Used
 * for category-scoped opt-outs — a user might consent to
 * UTILITY (transactional) and AUTHENTICATION (OTPs) but opt
 * out of MARKETING.
 */
export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export interface OptInQuery {
  /**
   * Optional template category filter. When omitted,
   * `isOptedIn` returns the overall opt-in status (false
   * only on global opt-out).
   */
  category?: TemplateCategory;
}

export interface OptInMeta {
  /** Category being opted into. If omitted, opt-in applies globally. */
  category?: TemplateCategory;
  /** Where the consent came from — webhook, web form, etc. */
  source?: string;
  /** Consent timestamp (ms). Defaults to current time. */
  timestamp?: number;
  /** Free-form metadata (e.g. consent record id, IP, user agent). */
  attributes?: Record<string, unknown>;
}

export interface OptOutOptions {
  /** Category being opted out of. If omitted, opt-out applies globally. */
  category?: TemplateCategory;
  /** Reason for the opt-out (audit log). */
  reason?: string;
  /** Opt-out timestamp (ms). Defaults to current time. */
  timestamp?: number;
}

/**
 * Pluggable consent-state primitive. Implement against any
 * backend (in-memory, Redis, Postgres, consent-ledger SaaS).
 *
 * `isOptedIn` semantics:
 *   - Returns `false` when the recipient has been explicitly
 *     opted out of the queried category (or globally, when
 *     `category` is omitted on the query).
 *   - Returns `true` otherwise — including for recipients
 *     with NO recorded state.
 *
 * This is "soft opt-in": consent assumed unless explicitly
 * opted out. Strict "hard opt-in" regimes (Ley 8968 marketing
 * pushes) implement their own registry that returns `false`
 * until `optIn` has been called.
 *
 * `optIn` and `optOut` SHALL be idempotent.
 */
export interface OptInRegistry {
  isOptedIn(recipient: string, options?: OptInQuery): Promise<boolean>;
  optIn(recipient: string, meta?: OptInMeta): Promise<void>;
  optOut(recipient: string, options?: OptOutOptions): Promise<void>;
}
