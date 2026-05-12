import { RateLimitError } from "../types/errors.js";

import { isRetryableError } from "./errors.js";

/**
 * Classification of a retryable failure. Used by the
 * `whatsapp.retry.reason` OTel span attribute and by
 * consumer-supplied {@link RetryHooks.onRetry} callbacks.
 */
export type RetryReason =
  | "transient_http" // 408 / 500 / 502 / 503 / 504
  | "rate_limit" // HTTP 429 OR Meta error code 130429
  | "network" // fetch failed (DNS, TCP, TLS)
  | "abort"; // AbortSignal fired mid-request

/**
 * Observation passed to `onRetry` for every scheduled retry.
 * Fires AFTER the SDK classifies the error as retryable,
 * BEFORE the backoff sleep. Synchronous side-effect only —
 * the retry helper does NOT await the hook's return value.
 */
export interface RetryInfo {
  /** 1-indexed attempt that just failed. */
  attempt: number;
  /** Classification of why the retry was scheduled. */
  reason: RetryReason;
  /** Backoff (ms) before the next attempt. */
  delayMs: number;
  /** The caught error. */
  error: unknown;
}

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
 * HTTP failure that should be retried. Carries the originating HTTP
 * status (so {@link classifyRetryReason} can distinguish 429 from other
 * transient statuses) and an optional Retry-After hint derived from
 * the response headers.
 */
export class TransientHttpError extends Error {
  public readonly retryAfterMs: number | undefined;
  /** Originating HTTP status (e.g. 429, 503). `0` when constructed without one. */
  public readonly status: number;

  constructor(message: string, retryAfterMs?: number, status: number = 0) {
    super(message);
    this.name = "TransientHttpError";
    this.retryAfterMs = retryAfterMs;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface RetryHooks {
  /** Optional sleep injection — in tests we pass a `vi.advanceTimersByTime`-friendly stub. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional RNG injection for deterministic jitter testing. Returns a value in [0, 1). */
  random?: () => number;
  /**
   * Invoked once per scheduled retry. Fires AFTER the SDK
   * classifies the error as retryable, BEFORE the backoff
   * sleep. Use to plumb per-retry data into your own metrics /
   * structured logging. The retry helper does NOT await the
   * return value; exceptions thrown by the hook are caught
   * and silently dropped so the retry loop is not affected.
   */
  onRetry?: (info: RetryInfo) => void;
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
      // Classify + notify BEFORE the sleep so observers see the
      // retry exactly as it is scheduled. `shouldRetry` returned
      // true above so `classifyRetryReason` cannot return
      // undefined here — defensive default just in case a future
      // tweak to shouldRetry diverges from classify.
      const reason = classifyRetryReason(err) ?? "transient_http";
      safelyInvokeOnRetry(hooks.onRetry, { attempt, reason, delayMs: delay, error: err });
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

/**
 * Classify a retryable error into a {@link RetryReason} for
 * telemetry. Returns `undefined` for non-retryable errors (the
 * retry helper short-circuits on these and never fires
 * `onRetry`, so the absence is correct).
 *
 * Exposed publicly so consumers writing custom retry shims or
 * mapping the SDK's spans into their own metrics can replicate
 * the same classification logic the SDK uses internally.
 */
export function classifyRetryReason(err: unknown): RetryReason | undefined {
  if (err instanceof TransientHttpError) {
    return err.status === 429 ? "rate_limit" : "transient_http";
  }
  if (err instanceof RateLimitError) {
    return "rate_limit";
  }
  if (isRetryableError(err)) {
    // Retryable typed error other than RateLimitError (e.g. a
    // future business-error classification). Default to
    // transient_http for now — extend this branch when a more
    // specific category lands.
    return "transient_http";
  }
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
    return "network";
  }
  if (err instanceof Error && err.name === "AbortError") {
    return "abort";
  }
  return undefined;
}

/** Invoke `onRetry` defensively — never let a hook throw break the retry loop. */
function safelyInvokeOnRetry(hook: ((info: RetryInfo) => void) | undefined, info: RetryInfo): void {
  if (hook === undefined) return;
  try {
    hook(info);
  } catch {
    // Swallow — hook errors must not break the retry contract.
  }
}
