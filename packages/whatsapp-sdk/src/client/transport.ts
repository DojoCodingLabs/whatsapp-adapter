import { randomUUID } from "node:crypto";

import { trace } from "@opentelemetry/api";

import { hashPhoneNumberId } from "../observability/redact.js";
import { withSpan } from "../observability/tracing.js";
import { META_GRAPH_BASE_URL } from "../types/constants.js";
import {
  AuthenticationError,
  CapabilityError,
  PermissionError,
  RateLimitError,
} from "../types/errors.js";

import { isRetryableHttpStatus, mapMetaError } from "./errors.js";
import {
  DEFAULT_RETRY_POLICY,
  parseRetryAfter,
  retry,
  type RetryHooks,
  type RetryPolicy,
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
      try {
        return await retry<T>(
          async () =>
            doFetch<T>(fetchImpl, bearerToken, method, url, body, requestId, options.signal),
          options.retryPolicy ?? DEFAULT_RETRY_POLICY,
          options.retryHooks ?? {}
        );
      } catch (err) {
        attachErrorAttributesToActiveSpan(err);
        throw err;
      }
    },
    {
      "whatsapp.method": method,
      "whatsapp.path": path.startsWith("/") ? path : `/${path}`,
      "whatsapp.phone_number_id": hashedPhoneNumberId,
      "whatsapp.request.id": requestId,
    }
  );
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

function extractMetaCode(err: unknown): number | undefined {
  if (err instanceof RateLimitError && typeof err.metaCode === "number") return err.metaCode;
  if (err instanceof AuthenticationError && typeof err.metaCode === "number") return err.metaCode;
  if (err instanceof PermissionError && typeof err.metaCode === "number") return err.metaCode;
  if (err instanceof CapabilityError && typeof err.metaCode === "number") return err.metaCode;
  return undefined;
}

async function doFetch<T>(
  fetchImpl: typeof fetch,
  bearerToken: string,
  method: HttpMethod,
  url: string,
  body: unknown,
  requestId: string,
  signal: AbortSignal | undefined
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
    Accept: "application/json",
    [REQUEST_ID_HEADER]: requestId,
  };
  let serializedBody: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    serializedBody = JSON.stringify(body);
  }

  const init: RequestInit = { method, headers };
  if (serializedBody !== undefined) {
    init.body = serializedBody;
  }
  if (signal !== undefined) {
    init.signal = signal;
  }

  const response = await fetchImpl(url, init);

  if (response.status >= 200 && response.status < 300) {
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  const parsedBody = await safeReadBody(response);

  if (isRetryableHttpStatus(response.status)) {
    const hint = parseRetryAfter(response.headers.get("retry-after"));
    throw new TransientHttpError(`Graph API ${response.status} (transient)`, hint);
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
