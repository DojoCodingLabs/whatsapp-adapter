import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";

/**
 * `transport.ts:84-86` documents an invariant:
 *
 *   "Resolve the bearer token EXACTLY ONCE per outer request.
 *    All retry attempts within this call use the same resolved
 *    value; re-resolving mid-retry would mask stale-token bugs."
 *
 * This suite codifies that. A regression where the token
 * resolver runs per-attempt would silently break consumers
 * using rotating-token `TokenProvider` callbacks.
 */

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const VALID_OPTIONS = {
  phoneNumberId: "PNID",
  wabaId: "WABA",
  appSecret: "APP",
} as const;

const FAST_RETRY = {
  maxAttempts: 4,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitter: "full" as const,
  floorMs: 0,
};

const captured: Array<{ authorization: string | null }> = [];

afterEach(() => {
  captured.length = 0;
});

function captureHandler(version: string, path: string, response: () => Response) {
  return http.all(`https://graph.facebook.com/${version}${path}`, ({ request }) => {
    captured.push({ authorization: request.headers.get("authorization") });
    return response();
  });
}

describe("transport — token resolution under retry", () => {
  it("TokenProvider is invoked exactly once per logical request — not per attempt", async () => {
    let providerCalls = 0;
    const tokenProvider = (): string => {
      providerCalls += 1;
      return `tok-${providerCalls}`;
    };

    let attemptNum = 0;
    server.use(
      captureHandler("v25.0", "/me", () => {
        attemptNum += 1;
        if (attemptNum < 3) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS, token: tokenProvider });
    await client.request("GET", "/me", undefined, {
      retryPolicy: FAST_RETRY,
      retryHooks: { sleep: () => Promise.resolve() },
    });

    // 3 HTTP attempts to Meta (two 503s then 200).
    expect(captured).toHaveLength(3);
    // Provider invoked ONCE — the resolved value cached for retries.
    expect(providerCalls).toBe(1);
    // All three attempts carry the same bearer value.
    const authValues = captured.map((c) => c.authorization);
    expect(new Set(authValues).size).toBe(1);
    expect(authValues[0]).toBe("Bearer tok-1");
  });

  it("two separate request() calls each invoke the provider once", async () => {
    let providerCalls = 0;
    const tokenProvider = (): string => {
      providerCalls += 1;
      return `tok-${providerCalls}`;
    };

    server.use(captureHandler("v25.0", "/me", () => HttpResponse.json({}, { status: 200 })));

    const client = new WhatsAppClient({ ...VALID_OPTIONS, token: tokenProvider });
    await client.request("GET", "/me", undefined, { retryPolicy: FAST_RETRY });
    await client.request("GET", "/me", undefined, { retryPolicy: FAST_RETRY });

    expect(providerCalls).toBe(2);
    expect(captured[0]?.authorization).toBe("Bearer tok-1");
    expect(captured[1]?.authorization).toBe("Bearer tok-2");
  });

  it("async TokenProvider resolved value is reused across retries", async () => {
    let providerCalls = 0;
    const tokenProvider = async (): Promise<string> => {
      providerCalls += 1;
      // Simulate fetching from a secrets manager.
      await new Promise((r) => setTimeout(r, 0));
      return `async-tok-${providerCalls}`;
    };

    let attemptNum = 0;
    server.use(
      captureHandler("v25.0", "/me", () => {
        attemptNum += 1;
        if (attemptNum < 2) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS, token: tokenProvider });
    await client.request("GET", "/me", undefined, {
      retryPolicy: FAST_RETRY,
      retryHooks: { sleep: () => Promise.resolve() },
    });

    expect(providerCalls).toBe(1);
    expect(captured).toHaveLength(2);
    expect(captured[0]?.authorization).toBe("Bearer async-tok-1");
    expect(captured[1]?.authorization).toBe("Bearer async-tok-1");
  });

  it("string token (non-provider) is reused identically across retries", async () => {
    let attemptNum = 0;
    server.use(
      captureHandler("v25.0", "/me", () => {
        attemptNum += 1;
        if (attemptNum < 3) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS, token: "static-token" });
    await client.request("GET", "/me", undefined, {
      retryPolicy: FAST_RETRY,
      retryHooks: { sleep: () => Promise.resolve() },
    });

    expect(captured).toHaveLength(3);
    for (const c of captured) {
      expect(c.authorization).toBe("Bearer static-token");
    }
  });
});
