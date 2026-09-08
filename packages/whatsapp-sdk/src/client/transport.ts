import { randomUUID } from "node:crypto";

import { trace } from "@opentelemetry/api";

import { hashPhoneNumberId } from "../observability/redact.js";
import { withSpan } from "../observability/tracing.js";
import { META_GRAPH_BASE_URL } from "../types/constants.js";
import {
  NetworkError,
  RateLimitError,
  RequestAbortedError,
  TransientError,
  WhatsAppError,
} from "../types/errors.js";

import {
  extractMetaCodeFromBody,
  isRateLimitMetaCode,
  isRetryableHttpStatus,
  mapMetaError,
} from "./errors.js";
import {
  DEFAULT_RETRY_POLICY,
  parseRetryAfter,
  retry,
  type RetryHooks,
  type RetryInfo,
  type RetryPolicy,
  type RetryReason,
  TransientHttpError,
} from "./retry.js";
import type { WhatsAppClient } from "./whatsapp-client.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface RequestOptions {
  /** Override the default retry policy for this call. */
  retryPolicy?: RetryPolicy;
  /** Test hooks; never set in production. */
  retryHooks?: RetryHooks;
  /** Per-call AbortSignal; cancellation is treated as a retryable error. */
  signal?: AbortSignal;
  /**
   * Override the resolved Graph API version for this call (rare — only
   * useful for cross-version migrations).
   */
  graphApiVersion?: string;
  /**
   * Optional caller-provided per-call identifier for **request
   * correlation**. When omitted, the SDK generates a fresh UUID
   * v4 per logical call and reuses it across retry attempts of
   * that call. Sent as `X-Request-Id` and recorded on the OTel
   * span as `whatsapp.request.id`.
   *
   * This is correlation only — Meta does NOT consult any
   * SDK-attached header for outbound deduplication. A retry of
   * `POST /messages` with the same `requestId` produces a new
   * WhatsApp send. Real outbound dedup is on the v2 roadmap
   * (the `outbound-deduper` capability).
   */
  requestId?: string;
  /** Override fetch implementation — internal hook used by tests. */
  fetchImpl?: typeof fetch;
  /**
   * Pass a raw request body (e.g. `FormData`, `Blob`, `Uint8Array`)
   * instead of the JSON-serialised `body`. When supplied, the SDK
   * does NOT set `Content-Type: application/json` — the runtime's
   * `fetch` infers the right header from the body type (e.g. the
   * multipart boundary for `FormData`). Used by the media-upload
   * capability; not part of the general send surface.
   *
   * Typed as `unknown` here so the SDK's `lib: ["ES2022"]` build
   * doesn't need the DOM-only `BodyInit` symbol — `fetch` accepts
   * the underlying types at runtime regardless.
   */
  bodyOverride?: unknown;
}

const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * Build the absolute URL for a Graph API call, tolerating zero or one
 * leading slashes on `path`.
 */
export function buildGraphUrl(version: string, path: string): string {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${META_GRAPH_BASE_URL}/${version}/${cleanPath}`;
}

/**
 * Execute an authenticated Graph API call. Pure helper that takes a client
 * for credentials/version, NOT a method on the class. Phase 1 wires the
 * class method to delegate here.
 */
export async function request<T>(
  client: WhatsAppClient,
  method: HttpMethod,
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const requestId = options.requestId ?? randomUUID();
  const version = options.graphApiVersion ?? client.graphApiVersion;
  const url = buildGraphUrl(version, path);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const hashedPhoneNumberId = await hashPhoneNumberId(client.phoneNumberId, client.redactSalt);
  // Resolve the bearer token EXACTLY ONCE per outer request. All
  // retry attempts within this call use the same resolved value;
  // re-resolving mid-retry would mask stale-token bugs.
  const bearerToken = await client._resolveBearerToken();

  return withSpan(
    "whatsapp.request",
    async () => {
      // Per-call retry tracker. Updated by the wrapped onRetry
      // hook below; emitted as span attributes after retry
      // resolves OR throws so dashboards see the count on both
      // happy and final-failure paths.
      let retryCount = 0;
      let retryReason: RetryReason | undefined;
      const consumerOnRetry = options.retryHooks?.onRetry;
      const hooks: RetryHooks = {
        ...(options.retryHooks ?? {}),
        onRetry: (info: RetryInfo): void => {
          retryCount += 1;
          retryReason = info.reason;
          // Forward to the consumer-supplied hook AFTER our own
          // tracking update so internal state is consistent if the
          // consumer reads it during their callback.
          consumerOnRetry?.(info);
        },
      };

      try {
        const result = await retry<T>(
          async () =>
            doFetch<T>(
              fetchImpl,
              bearerToken,
              method,
              url,
              body,
              requestId,
              options.signal,
              options.bodyOverride
            ),
          options.retryPolicy ?? DEFAULT_RETRY_POLICY,
          hooks
        );
        attachRetryAttributesToActiveSpan(retryCount, retryReason);
        return result;
      } catch (err) {
        // Every error that leaves the transport is a WhatsAppError.
        // Retry-loop markers (TransientHttpError), runtime network
        // failures (TypeError) and cancellations (AbortError) are
        // wrapped here, with the original as `cause`.
        const publicError = toPublicError(err, retryCount + 1);
        attachRetryAttributesToActiveSpan(retryCount, retryReason);
        attachErrorAttributesToActiveSpan(publicError);
        throw publicError;
      }
    },
    {
      "whatsapp.method": method,
      "whatsapp.path": spanPathAttribute(path),
      "whatsapp.phone_number_id": hashedPhoneNumberId,
      "whatsapp.request.id": requestId,
    }
  );
}

/**
 * Path component only, leading slash, query string stripped.
 *
 * Query strings can carry credentials (`/debug_token?input_token=…`),
 * so they never reach a span exporter. The wire URL is built from
 * the untouched path elsewhere.
 */
function spanPathAttribute(path: string): string {
  const queryStart = path.indexOf("?");
  const bare = queryStart === -1 ? path : path.slice(0, queryStart);
  return bare.startsWith("/") ? bare : `/${bare}`;
}

function attachRetryAttributesToActiveSpan(
  retryCount: number,
  retryReason: RetryReason | undefined
): void {
  const span = trace.getActiveSpan();
  if (span === undefined) return;
  span.setAttribute("whatsapp.retry.count", retryCount);
  if (retryCount > 0 && retryReason !== undefined) {
    span.setAttribute("whatsapp.retry.reason", retryReason);
  }
}

function attachErrorAttributesToActiveSpan(err: unknown): void {
  const span = trace.getActiveSpan();
  if (span === undefined) return;
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = err.code;
    if (typeof code === "string") {
      span.setAttribute("whatsapp.error.code", code);
    }
  }
  const metaCode = extractMetaCode(err);
  if (metaCode !== undefined) {
    span.setAttribute("whatsapp.error.meta_code", metaCode);
  }
}

/**
 * Meta error code carried by any typed error that has one
 * (`RateLimitError`, `AuthenticationError`, `PermissionError`,
 * `CapabilityError`, `TemplateError`, `OptOutError`,
 * `AccountRestrictedError`). Structural so a new class with a
 * `metaCode` field is picked up without touching this file.
 */
function extractMetaCode(err: unknown): number | undefined {
  if (!(err instanceof WhatsAppError)) return undefined;
  const metaCode = (err as { metaCode?: unknown }).metaCode;
  return typeof metaCode === "number" ? metaCode : undefined;
}

/**
 * Convert whatever escaped the retry loop into the typed error the
 * consumer is promised. Typed `WhatsAppError`s pass through
 * untouched.
 */
function toPublicError(err: unknown, attempts: number): WhatsAppError {
  if (err instanceof WhatsAppError) return err;

  if (err instanceof TransientHttpError) {
    const isRateLimit =
      err.status === 429 || (err.metaCode !== undefined && isRateLimitMetaCode(err.metaCode));
    if (isRateLimit) {
      return new RateLimitError(
        `Graph API rate limit (HTTP ${err.status}) persisted after ${attempts} attempt(s)`,
        {
          ...(err.metaCode !== undefined ? { metaCode: err.metaCode } : {}),
          ...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
        },
        { cause: err }
      );
    }
    return new TransientError(
      `Graph API HTTP ${err.status} persisted after ${attempts} attempt(s)`,
      {
        httpStatus: err.status,
        attempts,
        ...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
      },
      { cause: err }
    );
  }

  if (err instanceof Error && err.name === "AbortError") {
    return new RequestAbortedError(undefined, { cause: err });
  }

  // Node/undici surfaces DNS, TCP and TLS failures as
  // `TypeError: fetch failed` with the socket error as `cause`.
  if (err instanceof TypeError && /fetch failed|network/i.test(err.message)) {
    const inner = (err as { cause?: unknown }).cause;
    const detail = inner instanceof Error ? ` (${inner.message})` : "";
    return new NetworkError(`Network request to Graph API failed: ${err.message}${detail}`, {
      cause: err,
    });
  }

  return new WhatsAppError(
    "UNKNOWN",
    err instanceof Error ? err.message : "Graph API request failed with a non-Error value",
    { cause: err }
  );
}

async function doFetch<T>(
  fetchImpl: typeof fetch,
  bearerToken: string,
  method: HttpMethod,
  url: string,
  body: unknown,
  requestId: string,
  signal: AbortSignal | undefined,
  bodyOverride: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
    Accept: "application/json",
    [REQUEST_ID_HEADER]: requestId,
  };
  // Use a structural type for the body — the DOM-only `BodyInit`
  // symbol isn't in our `lib: ["ES2022"]` build, but fetch accepts
  // these underlying types at runtime.
  let resolvedBody: string | Uint8Array | ArrayBuffer | Blob | FormData | undefined;
  if (bodyOverride !== undefined) {
    // Caller supplied a pre-built request body (e.g. FormData for
    // multipart media upload). Do NOT set Content-Type — fetch
    // infers it from the body type, including the multipart
    // boundary.
    resolvedBody = bodyOverride as typeof resolvedBody;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    resolvedBody = JSON.stringify(body);
  }

  const init: RequestInit = { method, headers };
  if (resolvedBody !== undefined) {
    // Cast via a narrowed local so `exactOptionalPropertyTypes`
    // doesn't see an `| undefined` arm in the right-hand side.
    // Safe at runtime: every value we hand fetch here is a
    // concrete BodyInit member.
    const finalBody = resolvedBody as NonNullable<RequestInit["body"]>;
    init.body = finalBody;
  }
  if (signal !== undefined) {
    init.signal = signal;
  }

  const response = await fetchImpl(url, init);

  if (response.status >= 200 && response.status < 300) {
    if (response.status === 204) {
      return undefined as T;
    }
    try {
      return (await response.json()) as T;
    } catch (err) {
      // A 2xx we cannot parse is NOT retried: for POST /messages the
      // send most likely went through and a retry would double-send.
      throw new WhatsAppError(
        "UNKNOWN",
        `Graph API ${response.status} returned a body that is not valid JSON`,
        { cause: err }
      );
    }
  }

  const parsedBody = await safeReadBody(response);

  if (isRetryableHttpStatus(response.status)) {
    const hint = parseRetryAfter(response.headers.get("retry-after"));
    throw new TransientHttpError(
      `Graph API ${response.status} (transient)`,
      hint,
      response.status,
      extractMetaCodeFromBody(parsedBody)
    );
  }

  // Non-transient: map to typed error and throw. The retry layer's
  // shouldRetry() will route a retryable RateLimitError back into the
  // loop; everything else propagates immediately.
  throw mapMetaError(response.status, parsedBody);
}

async function safeReadBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      return await response.json();
    }
    return await response.text();
  } catch {
    return undefined;
  }
}
