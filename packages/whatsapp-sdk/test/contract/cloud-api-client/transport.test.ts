import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TransientHttpError } from "../../../src/client/retry.js";
import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import {
  NetworkError,
  RateLimitError,
  RequestAbortedError,
  TransientError,
  UndeliverableError,
  WhatsAppError,
  WindowClosedError,
} from "../../../src/types/errors.js";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const VALID_OPTIONS = {
  phoneNumberId: "PNID",
  wabaId: "WABA",
  token: "TOKEN-VALUE",
  appSecret: "APP-SECRET-VALUE",
} as const;

const NO_RETRY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitter: "full" as const,
  floorMs: 0,
};

const captured: Array<{ url: string; method: string; headers: Headers; body: string | null }> = [];

function captureHandler(version: string, path: string, response: () => Response) {
  return http.all(`https://graph.facebook.com/${version}${path}`, async ({ request }) => {
    captured.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body ? await request.text() : null,
    });
    return response();
  });
}

afterEach(() => {
  captured.length = 0;
});

describe("transport: 200 OK round-trip", () => {
  it("parses JSON, sets Authorization, sets Accept, attaches X-Request-Id", async () => {
    server.use(
      captureHandler("v26.0", "/me", () =>
        HttpResponse.json({ id: "1", name: "test" }, { status: 200 })
      )
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const result = await client.request<{ id: string; name: string }>("GET", "/me", undefined, {
      retryPolicy: NO_RETRY,
    });

    expect(result).toEqual({ id: "1", name: "test" });
    expect(captured).toHaveLength(1);
    const c = captured[0]!;
    expect(c.method).toBe("GET");
    expect(c.url).toBe("https://graph.facebook.com/v26.0/me");
    expect(c.headers.get("authorization")).toBe("Bearer TOKEN-VALUE");
    expect(c.headers.get("accept")).toBe("application/json");
    const id = c.headers.get("x-request-id");
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    // No body sent on GET
    expect(c.body).toBeNull();
    expect(c.headers.get("content-type")).toBeNull();
  });

  it("resolves a TokenProvider callback to populate Authorization per request", async () => {
    server.use(
      captureHandler("v26.0", "/me", () => HttpResponse.json({ id: "1" }, { status: 200 }))
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS, token: () => "DYNAMIC-TOK" });
    await client.request<{ id: string }>("GET", "/me", undefined, { retryPolicy: NO_RETRY });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.headers.get("authorization")).toBe("Bearer DYNAMIC-TOK");
  });
});

describe("transport: body serialization", () => {
  it("only sets Content-Type and serializes body when one is provided", async () => {
    server.use(
      captureHandler("v26.0", "/PNID/messages", () =>
        HttpResponse.json({ ok: true }, { status: 200 })
      )
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request(
      "POST",
      "/PNID/messages",
      { messaging_product: "whatsapp", to: "X" },
      { retryPolicy: NO_RETRY }
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]!.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(captured[0]!.body!)).toEqual({ messaging_product: "whatsapp", to: "X" });
  });
});

describe("transport: URL construction", () => {
  it("uses the resolved graphApiVersion (default v26.0)", async () => {
    server.use(
      captureHandler("v26.0", "/PNID/messages", () => HttpResponse.json({}, { status: 200 }))
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/PNID/messages", undefined, { retryPolicy: NO_RETRY });
    expect(captured[0]!.url).toBe("https://graph.facebook.com/v26.0/PNID/messages");
  });

  it("honours a custom version override on the client", async () => {
    server.use(
      captureHandler("v22.0", "/PNID/messages", () => HttpResponse.json({}, { status: 200 }))
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS, graphApiVersion: "v22.0" });
    await client.request("GET", "/PNID/messages", undefined, { retryPolicy: NO_RETRY });
    expect(captured[0]!.url).toBe("https://graph.facebook.com/v22.0/PNID/messages");
  });

  it("tolerates a path without a leading slash", async () => {
    server.use(
      captureHandler("v26.0", "/PNID/messages", () => HttpResponse.json({}, { status: 200 }))
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "PNID/messages", undefined, { retryPolicy: NO_RETRY });
    expect(captured[0]!.url).toBe("https://graph.facebook.com/v26.0/PNID/messages");
  });
});

describe("transport: request-id correlation behaviour", () => {
  it("each call gets a fresh request id", async () => {
    server.use(captureHandler("v26.0", "/me", () => HttpResponse.json({}, { status: 200 })));
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, { retryPolicy: NO_RETRY });
    await client.request("GET", "/me", undefined, { retryPolicy: NO_RETRY });
    expect(captured).toHaveLength(2);
    expect(captured[0]!.headers.get("x-request-id")).not.toBe(
      captured[1]!.headers.get("x-request-id")
    );
  });

  it("stays stable across retries of one call", async () => {
    let callCount = 0;
    server.use(
      captureHandler("v26.0", "/me", () => {
        callCount += 1;
        if (callCount < 3) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, {
      retryPolicy: { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0, jitter: "full", floorMs: 0 },
      retryHooks: { sleep: () => Promise.resolve() },
    });
    expect(captured).toHaveLength(3);
    const ids = captured.map((c) => c.headers.get("x-request-id"));
    expect(new Set(ids).size).toBe(1);
  });

  it("respects a caller-provided request id", async () => {
    server.use(captureHandler("v26.0", "/me", () => HttpResponse.json({}, { status: 200 })));
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, {
      retryPolicy: NO_RETRY,
      requestId: "caller-supplied-id",
    });
    expect(captured[0]!.headers.get("x-request-id")).toBe("caller-supplied-id");
  });

  it("does NOT emit the legacy X-Dojo-Idempotency-Key header", async () => {
    server.use(captureHandler("v26.0", "/me", () => HttpResponse.json({}, { status: 200 })));
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, { retryPolicy: NO_RETRY });
    expect(captured[0]!.headers.get("x-dojo-idempotency-key")).toBeNull();
  });
});

describe("transport: error mapping", () => {
  it("retries 503 then succeeds", async () => {
    let calls = 0;
    server.use(
      captureHandler("v26.0", "/me", () => {
        calls += 1;
        if (calls < 3) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const result = await client.request<{ ok: boolean }>("GET", "/me", undefined, {
      retryPolicy: { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0, jitter: "full", floorMs: 0 },
      retryHooks: { sleep: () => Promise.resolve() },
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("retries on RateLimitError code 131056 then succeeds", async () => {
    let calls = 0;
    server.use(
      captureHandler("v26.0", "/PNID/messages", () => {
        calls += 1;
        if (calls < 2) {
          return HttpResponse.json(
            { error: { code: 131056, message: "(#131056) pair rate limit" } },
            { status: 400 }
          );
        }
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request<{ ok: boolean }>(
      "POST",
      "/PNID/messages",
      { messaging_product: "whatsapp" },
      {
        retryPolicy: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: "full", floorMs: 0 },
        retryHooks: { sleep: () => Promise.resolve() },
      }
    );
    expect(calls).toBe(2);
  });

  it("does NOT retry on WindowClosedError code 131047; throws immediately", async () => {
    let calls = 0;
    server.use(
      captureHandler("v26.0", "/PNID/messages", () => {
        calls += 1;
        return HttpResponse.json(
          {
            error: {
              code: 131047,
              message: "(#131047) Re-engagement message",
              error_data: { recipient_phone_number: "521234567890" },
            },
          },
          { status: 400 }
        );
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(
      client.request(
        "POST",
        "/PNID/messages",
        { messaging_product: "whatsapp" },
        {
          retryPolicy: {
            maxAttempts: 4,
            baseDelayMs: 0,
            maxDelayMs: 0,
            jitter: "full",
            floorMs: 0,
          },
          retryHooks: { sleep: () => Promise.resolve() },
        }
      )
    ).rejects.toBeInstanceOf(WindowClosedError);
    expect(calls).toBe(1);
  });

  it("does NOT retry on UndeliverableError code 131026; throws immediately", async () => {
    let calls = 0;
    server.use(
      captureHandler("v26.0", "/PNID/messages", () => {
        calls += 1;
        return HttpResponse.json(
          {
            error: {
              code: 131026,
              message: "(#131026) Message undeliverable",
              error_data: { recipient_phone_number: "521234567890" },
            },
          },
          { status: 400 }
        );
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(
      client.request(
        "POST",
        "/PNID/messages",
        { messaging_product: "whatsapp" },
        {
          retryPolicy: {
            maxAttempts: 4,
            baseDelayMs: 0,
            maxDelayMs: 0,
            jitter: "full",
            floorMs: 0,
          },
          retryHooks: { sleep: () => Promise.resolve() },
        }
      )
    ).rejects.toBeInstanceOf(UndeliverableError);
    expect(calls).toBe(1);
  });

  it("RateLimitError without a retryable metaCode propagates", async () => {
    server.use(
      captureHandler("v26.0", "/me", () =>
        HttpResponse.json({ error: { code: 131998, message: "non-retryable" } }, { status: 400 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(
      client.request("GET", "/me", undefined, { retryPolicy: NO_RETRY })
    ).rejects.toBeInstanceOf(WhatsAppError);
  });

  it("exhausts retries on persistent 503 and throws TransientError (a WhatsAppError)", async () => {
    server.use(
      captureHandler(
        "v26.0",
        "/me",
        () => new HttpResponse(null, { status: 503, headers: { "retry-after": "2" } })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    let caught: unknown;
    try {
      await client.request("GET", "/me", undefined, {
        retryPolicy: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: "full", floorMs: 0 },
        retryHooks: { sleep: () => Promise.resolve() },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TransientError);
    expect(caught).toBeInstanceOf(WhatsAppError);
    expect(caught).not.toBeInstanceOf(TransientHttpError);
    const te = caught as TransientError;
    expect(te.code).toBe("TRANSIENT");
    expect(te.httpStatus).toBe(503);
    expect(te.attempts).toBe(3);
    expect(te.retryAfterMs).toBe(2000);
    expect((te as unknown as { cause: unknown }).cause).toBeInstanceOf(TransientHttpError);
    expect(captured).toHaveLength(3);
  });

  it("exhausts retries on HTTP 429 without a Meta envelope and throws RateLimitError", async () => {
    server.use(
      captureHandler(
        "v26.0",
        "/me",
        () => new HttpResponse("slow down", { status: 429, headers: { "retry-after": "1" } })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    let caught: unknown;
    try {
      await client.request("GET", "/me", undefined, {
        retryPolicy: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: "full", floorMs: 0 },
        retryHooks: { sleep: () => Promise.resolve() },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    const rl = caught as RateLimitError;
    expect(rl.metaCode).toBeUndefined();
    expect(rl.retryAfterMs).toBe(1000);
  });

  it("HTTP 429 carrying a Meta throttling envelope surfaces RateLimitError with that metaCode", async () => {
    server.use(
      captureHandler("v26.0", "/WABA/message_templates", () =>
        HttpResponse.json(
          { error: { code: 80007, message: "(#80007) There have been too many calls" } },
          { status: 429 }
        )
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    let caught: unknown;
    try {
      await client.request("GET", "/WABA/message_templates", undefined, {
        retryPolicy: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: "full", floorMs: 0 },
        retryHooks: { sleep: () => Promise.resolve() },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).metaCode).toBe(80007);
    expect(captured).toHaveLength(2);
  });

  it("a 2xx with a non-JSON body throws WhatsAppError(UNKNOWN) and is NOT retried", async () => {
    server.use(
      captureHandler(
        "v26.0",
        "/PNID/messages",
        () => new HttpResponse("<html>ok</html>", { status: 200 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    let caught: unknown;
    try {
      await client.request(
        "POST",
        "/PNID/messages",
        { messaging_product: "whatsapp" },
        {
          retryPolicy: {
            maxAttempts: 3,
            baseDelayMs: 0,
            maxDelayMs: 0,
            jitter: "full",
            floorMs: 0,
          },
          retryHooks: { sleep: () => Promise.resolve() },
        }
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WhatsAppError);
    expect(caught).not.toBeInstanceOf(SyntaxError);
    expect((caught as WhatsAppError).code).toBe("UNKNOWN");
    expect((caught as { cause: unknown }).cause).toBeInstanceOf(SyntaxError);
    // One attempt only — a retried POST /messages would double-send.
    expect(captured).toHaveLength(1);
  });

  it("a fetch that fails at the network layer surfaces NetworkError with the TypeError as cause", async () => {
    const failingFetch: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    let caught: unknown;
    try {
      await client.request("GET", "/me", undefined, {
        fetchImpl: failingFetch,
        retryPolicy: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: "full", floorMs: 0 },
        retryHooks: { sleep: () => Promise.resolve() },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NetworkError);
    expect(caught).toBeInstanceOf(WhatsAppError);
    expect((caught as { cause: unknown }).cause).toBeInstanceOf(TypeError);
  });

  it("an AbortSignal that fires surfaces RequestAbortedError, never a raw AbortError", async () => {
    server.use(
      captureHandler("v26.0", "/me", () => HttpResponse.json({ id: "1" }, { status: 200 }))
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const ac = new AbortController();
    ac.abort();
    let caught: unknown;
    try {
      await client.request("GET", "/me", undefined, {
        signal: ac.signal,
        retryPolicy: NO_RETRY,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RequestAbortedError);
    expect(caught).toBeInstanceOf(WhatsAppError);
    expect((caught as WhatsAppError).code).toBe("ABORTED");
    expect((caught as { cause: Error }).cause.name).toBe("AbortError");
  });

  it("a caller abort is honoured immediately under the DEFAULT retry policy — no retries, no backoff", async () => {
    server.use(
      captureHandler("v26.0", "/me", () => HttpResponse.json({ id: "1" }, { status: 200 }))
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const ac = new AbortController();
    ac.abort();
    const sleep = vi.fn(() => Promise.resolve());
    const onRetry = vi.fn();
    const started = Date.now();
    let caught: unknown;
    try {
      // Default policy: 4 attempts, up to ~8 s of jittered backoff.
      await client.request("GET", "/me", undefined, {
        signal: ac.signal,
        retryHooks: { sleep, onRetry },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RequestAbortedError);
    expect(sleep).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("an abort mid-backoff after a 503 surfaces RequestAbortedError with the caller's reason as cause", async () => {
    let hits = 0;
    server.use(
      captureHandler("v26.0", "/me", () => {
        hits += 1;
        return HttpResponse.json({ error: { code: 2, message: "down" } }, { status: 503 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const ac = new AbortController();
    const reason = new Error("user closed the tab");
    // Sleep that never resolves on its own — only the abort can end it.
    const sleep = (): Promise<void> => new Promise(() => undefined);
    const pending = client.request("GET", "/me", undefined, {
      signal: ac.signal,
      retryHooks: { sleep },
    });
    const settled = pending.then(
      () => "resolved",
      (err: unknown) => err
    );
    // Let the first attempt fail and the loop enter its sleep.
    await new Promise((r) => setTimeout(r, 20));
    ac.abort(reason);
    const caught = await settled;
    expect(caught).toBeInstanceOf(RequestAbortedError);
    expect((caught as { cause: unknown }).cause).toBe(reason);
    expect(hits).toBe(1);
  });

  // Suppress unused-import warning when only used in the rate-limit assertion above.
  it("RateLimitError class is reachable from the public surface", () => {
    expect(RateLimitError).toBeDefined();
  });
});
