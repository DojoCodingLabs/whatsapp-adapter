import { isRetryableError } from "./errors.js";

export interface RetryPolicy {
  /** Total attempts including the first call. */
  maxAttempts: number;
  /** Base delay used as the seed for exponential backoff. */
  baseDelayMs: number;
  /** Hard cap on any single delay. */
  maxDelayMs: number;
  /** Jitter strategy. Only "full" is supported in v1. */
  jitter: "full";
  /** Lower bound on every delay (avoids 0-ms hammering when jitter rolls 0). */
  floorMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 8000,
  jitter: "full",
  floorMs: 50,
};

/**
 * Marker thrown by callers (or the transport layer) to signal a transient
 * HTTP failure that should be retried. Carries optional Retry-After hint
 * derived from the response headers.
 */
export class TransientHttpError extends Error {
  public readonly retryAfterMs: number | undefined;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "TransientHttpError";
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface RetryHooks {
  /** Optional sleep injection — in tests we pass a `vi.advanceTimersByTime`-friendly stub. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional RNG injection for deterministic jitter testing. Returns a value in [0, 1). */
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Compute a single full-jitter delay, capped to `maxDelayMs` and floored to `floorMs`. */
export function fullJitterDelay(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random
): number {
  const exp = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const cap = Math.min(policy.maxDelayMs, exp);
  const sample = random() * cap;
  return Math.max(policy.floorMs, sample);
}

/**
 * Parse a `Retry-After` header value (numeric seconds or HTTP-date).
 * Returns the resolved delay in milliseconds, or `undefined` if the value
 * cannot be interpreted.
 */
export function parseRetryAfter(
  headerValue: string | null | undefined,
  now: number = Date.now()
): number | undefined {
  if (typeof headerValue !== "string") return undefined;
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return undefined;

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.floor(asNumber * 1000);
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, parsedDate - now);
  }

  return undefined;
}

/**
 * Run `fn`, retrying on transient failures using exponential backoff with
 * full jitter. The decision of "retryable" is delegated to:
 *   - `TransientHttpError` thrown by `fn` (typically wrapping a 408/429/5xx)
 *   - `isRetryableError(err)` for typed `WhatsAppError` subclasses
 *
 * Honours `Retry-After` from `TransientHttpError.retryAfterMs` when present
 * (capped to `maxDelayMs`).
 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  hooks: RetryHooks = {}
): Promise<T> {
  const sleep = hooks.sleep ?? defaultSleep;
  const random = hooks.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === policy.maxAttempts || !shouldRetry(err)) {
        throw err;
      }
      const hint = err instanceof TransientHttpError ? err.retryAfterMs : undefined;
      const baseDelay = fullJitterDelay(attempt, policy, random);
      const delay =
        typeof hint === "number"
          ? Math.min(policy.maxDelayMs, Math.max(policy.floorMs, hint))
          : baseDelay;
      await sleep(delay);
    }
  }
  // Unreachable: the loop either returns or throws.
  throw lastError instanceof Error ? lastError : new Error("retry: exhausted");
}

function shouldRetry(err: unknown): boolean {
  if (err instanceof TransientHttpError) return true;
  if (isRetryableError(err)) return true;
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}
