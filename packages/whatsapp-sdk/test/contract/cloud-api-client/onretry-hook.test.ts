import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RetryInfo } from "../../../src/client/retry.js";
import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";

/**
 * Consumer-facing onRetry hook contract:
 *   - Fires once per scheduled retry, with full RetryInfo
 *   - Composes safely with the SDK's internal retry tracker
 *   - Hook exceptions do NOT break the retry loop
 */

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const VALID_OPTIONS = {
  phoneNumberId: "PNID",
  wabaId: "WABA",
  token: "TOKEN",
  appSecret: "APP",
} as const;

const FAST_RETRY = {
  maxAttempts: 4,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitter: "full" as const,
  floorMs: 0,
};

describe("RetryHooks.onRetry contract", () => {
  it("fires once per scheduled retry with the canonical RetryInfo", async () => {
    let calls = 0;
    server.use(
      http.get("https://graph.facebook.com/v25.0/me", () => {
        calls += 1;
        if (calls < 3) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );

    const observed: RetryInfo[] = [];
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, {
      retryPolicy: FAST_RETRY,
      retryHooks: {
        sleep: () => Promise.resolve(),
        onRetry: (info) => {
          observed.push(info);
        },
      },
    });

    expect(observed).toHaveLength(2);
    expect(observed[0]?.attempt).toBe(1);
    expect(observed[0]?.reason).toBe("transient_http");
    expect(observed[0]?.error).toBeInstanceOf(Error);
    expect(observed[1]?.attempt).toBe(2);
    expect(observed[1]?.reason).toBe("transient_http");
  });

  it("hook receives the rate_limit classification on a 429", async () => {
    let calls = 0;
    server.use(
      http.get("https://graph.facebook.com/v25.0/me", () => {
        calls += 1;
        if (calls < 2) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );

    const observed: RetryInfo[] = [];
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, {
      retryPolicy: FAST_RETRY,
      retryHooks: {
        sleep: () => Promise.resolve(),
        onRetry: (info) => {
          observed.push(info);
        },
      },
    });

    expect(observed).toHaveLength(1);
    expect(observed[0]?.reason).toBe("rate_limit");
  });

  it("hook exception does NOT break the retry — call still succeeds", async () => {
    let calls = 0;
    server.use(
      http.get("https://graph.facebook.com/v25.0/me", () => {
        calls += 1;
        if (calls < 2) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );

    const throwingHook = vi.fn(() => {
      throw new Error("consumer hook blew up");
    });
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, {
      retryPolicy: FAST_RETRY,
      retryHooks: {
        sleep: () => Promise.resolve(),
        onRetry: throwingHook,
      },
    });

    expect(throwingHook).toHaveBeenCalledTimes(1);
  });
});
