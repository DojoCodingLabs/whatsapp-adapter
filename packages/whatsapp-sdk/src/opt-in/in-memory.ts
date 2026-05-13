/**
 * Default in-memory `OptInRegistry`. Tracks explicit opt-ins
 * and opt-outs in process-local Maps. Safe for tests,
 * development, and single-process production deployments.
 *
 * Multi-process / multi-node deployments use a registry
 * backed by shared storage. The cookbook documents the
 * canonical Postgres adapter shape.
 */

import type {
  OptInMeta,
  OptInQuery,
  OptInRegistry,
  OptOutOptions,
  TemplateCategory,
} from "./types.js";

/** Special key naming a global opt-out (no category). */
const GLOBAL = Symbol("global");
type CategoryOrGlobal = TemplateCategory | typeof GLOBAL;

interface OptOutRecord {
  category: CategoryOrGlobal;
  reason?: string;
  timestamp: number;
}

interface OptInRecord {
  category: CategoryOrGlobal;
  source?: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export class InMemoryOptInRegistry implements OptInRegistry {
  // Recipient → Set of categories (or GLOBAL) they've opted out of.
  readonly #optOuts: Map<string, Map<CategoryOrGlobal, OptOutRecord>> = new Map();
  // Recipient → Set of opt-in records (audit trail; latest wins).
  readonly #optIns: Map<string, Map<CategoryOrGlobal, OptInRecord>> = new Map();

  public isOptedIn(recipient: string, options?: OptInQuery): Promise<boolean> {
    const outsForRecipient = this.#optOuts.get(recipient);
    if (outsForRecipient === undefined || outsForRecipient.size === 0) {
      return Promise.resolve(true);
    }
    // A global opt-out blocks every category query.
    if (outsForRecipient.has(GLOBAL)) {
      return Promise.resolve(false);
    }
    // Category-scoped query: blocked only if the specific
    // category has been opted out.
    if (options?.category !== undefined) {
      return Promise.resolve(!outsForRecipient.has(options.category));
    }
    // Unscoped query AND no global opt-out: there are
    // category-scoped opt-outs, but the consumer asked about
    // overall status. Soft semantic — overall opt-in is true
    // (the recipient hasn't globally opted out).
    return Promise.resolve(true);
  }

  public optIn(recipient: string, meta?: OptInMeta): Promise<void> {
    const category: CategoryOrGlobal = meta?.category ?? GLOBAL;
    // Re-consenting clears any opt-out for the same scope.
    const outs = this.#optOuts.get(recipient);
    if (outs !== undefined) {
      outs.delete(category);
      if (category === GLOBAL) {
        // Global opt-in supersedes every category-scoped opt-out.
        outs.clear();
      }
      if (outs.size === 0) {
        this.#optOuts.delete(recipient);
      }
    }
    // Record the opt-in (latest wins on the same scope).
    let inSet = this.#optIns.get(recipient);
    if (inSet === undefined) {
      inSet = new Map();
      this.#optIns.set(recipient, inSet);
    }
    const record: OptInRecord = {
      category,
      timestamp: meta?.timestamp ?? Date.now(),
      ...(meta?.source !== undefined ? { source: meta.source } : {}),
      ...(meta?.attributes !== undefined ? { attributes: meta.attributes } : {}),
    };
    inSet.set(category, record);
    return Promise.resolve();
  }

  public optOut(recipient: string, options?: OptOutOptions): Promise<void> {
    const category: CategoryOrGlobal = options?.category ?? GLOBAL;
    let outs = this.#optOuts.get(recipient);
    if (outs === undefined) {
      outs = new Map();
      this.#optOuts.set(recipient, outs);
    }
    const record: OptOutRecord = {
      category,
      timestamp: options?.timestamp ?? Date.now(),
      ...(options?.reason !== undefined ? { reason: options.reason } : {}),
    };
    outs.set(category, record);
    return Promise.resolve();
  }
}
