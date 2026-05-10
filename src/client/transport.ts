import { randomUUID } from "node:crypto";

import { trace } from "@opentelemetry/api";

import { hashPhoneNumberId } from "../observability/redact.js";
import { withSpan } from "../observability/tracing.js";
import { META_GRAPH_BASE_URL } from "../types/constants.js";
import { RateLimitError } from "../types/errors.js";

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
  /** Optional caller-provided idempotency key (uses a fresh UUID v4 if absent). */
  idempotencyKey?: string;
  /** Override fetch implementation — internal hook used by tests. */
  fetchImpl?: typeof fetch;
}

const IDEMPOTENCY_HEADER = "X-Dojo-Idempotency-Key";

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
  const idempotencyKey = options.idempotencyKey ?? randomUUID();
  const version = options.graphApiVersion ?? client.graphApiVersion;
  const url = buildGraphUrl(version, path);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return withSpan(
    "whatsapp.request",
    async () => {
      try {
        return await retry<T>(
          async () =>
            doFetch<T>(fetchImpl, client, method, url, body, idempotencyKey, options.signal),
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
      "whatsapp.phone_number_id": hashPhoneNumberId(client.phoneNumberId),
      "whatsapp.idempotency_key": idempotencyKey,
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
  if (err instanceof RateLimitError && typeof err.metaCode === "number") {
    span.setAttribute("whatsapp.error.meta_code", err.metaCode);
  }
}

async function doFetch<T>(
  fetchImpl: typeof fetch,
  client: WhatsAppClient,
  method: HttpMethod,
  url: string,
  body: unknown,
  idempotencyKey: string,
  signal: AbortSignal | undefined
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${client._getBearerToken()}`,
    Accept: "application/json",
    [IDEMPOTENCY_HEADER]: idempotencyKey,
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
