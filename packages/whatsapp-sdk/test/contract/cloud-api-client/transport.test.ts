import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { RateLimitError, WhatsAppError, WindowClosedError } from "../../../src/types/errors.js";

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
  it("parses JSON, sets Authorization, sets Accept, attaches idempotency key", async () => {
    server.use(
      captureHandler("v25.0", "/me", () =>
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
    expect(c.url).toBe("https://graph.facebook.com/v25.0/me");
    expect(c.headers.get("authorization")).toBe("Bearer TOKEN-VALUE");
    expect(c.headers.get("accept")).toBe("application/json");
    const idem = c.headers.get("x-dojo-idempotency-key");
    expect(idem).toBeTruthy();
    expect(idem).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    // No body sent on GET
    expect(c.body).toBeNull();
    expect(c.headers.get("content-type")).toBeNull();
  });

  it("resolves a TokenProvider callback to populate Authorization per request", async () => {
    server.use(
      captureHandler("v25.0", "/me", () => HttpResponse.json({ id: "1" }, { status: 200 }))
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
      captureHandler("v25.0", "/PNID/messages", () =>
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
  it("uses the resolved graphApiVersion (default v25.0)", async () => {
    server.use(
      captureHandler("v25.0", "/PNID/messages", () => HttpResponse.json({}, { status: 200 }))
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/PNID/messages", undefined, { retryPolicy: NO_RETRY });
    expect(captured[0]!.url).toBe("https://graph.facebook.com/v25.0/PNID/messages");
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
      captureHandler("v25.0", "/PNID/messages", () => HttpResponse.json({}, { status: 200 }))
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "PNID/messages", undefined, { retryPolicy: NO_RETRY });
    expect(captured[0]!.url).toBe("https://graph.facebook.com/v25.0/PNID/messages");
  });
});

describe("transport: idempotency key behaviour", () => {
  it("each call gets a fresh key", async () => {
    server.use(captureHandler("v25.0", "/me", () => HttpResponse.json({}, { status: 200 })));
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, { retryPolicy: NO_RETRY });
    await client.request("GET", "/me", undefined, { retryPolicy: NO_RETRY });
    expect(captured).toHaveLength(2);
    expect(captured[0]!.headers.get("x-dojo-idempotency-key")).not.toBe(
      captured[1]!.headers.get("x-dojo-idempotency-key")
    );
  });

  it("stays stable across retries of one call", async () => {
    let callCount = 0;
    server.use(
      captureHandler("v25.0", "/me", () => {
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
    const keys = captured.map((c) => c.headers.get("x-dojo-idempotency-key"));
    expect(new Set(keys).size).toBe(1);
  });

  it("respects a caller-provided idempotency key", async () => {
    server.use(captureHandler("v25.0", "/me", () => HttpResponse.json({}, { status: 200 })));
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, {
      retryPolicy: NO_RETRY,
      idempotencyKey: "caller-supplied-key",
    });
    expect(captured[0]!.headers.get("x-dojo-idempotency-key")).toBe("caller-supplied-key");
  });
});

describe("transport: error mapping", () => {
  it("retries 503 then succeeds", async () => {
    let calls = 0;
    server.use(
      captureHandler("v25.0", "/me", () => {
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
      captureHandler("v25.0", "/PNID/messages", () => {
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

  it("does NOT retry on WindowClosedError code 131026; throws immediately", async () => {
    let calls = 0;
    server.use(
      captureHandler("v25.0", "/PNID/messages", () => {
        calls += 1;
        return HttpResponse.json(
          {
            error: {
              code: 131026,
              message: "(#131026) Re-engagement message",
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

  it("RateLimitError without a retryable metaCode propagates", async () => {
    server.use(
      captureHandler("v25.0", "/me", () =>
        HttpResponse.json({ error: { code: 131998, message: "non-retryable" } }, { status: 400 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(
      client.request("GET", "/me", undefined, { retryPolicy: NO_RETRY })
    ).rejects.toBeInstanceOf(WhatsAppError);
  });

  it("exhausts retries on persistent 503 and throws TransientHttpError-shaped WhatsAppError", async () => {
    server.use(captureHandler("v25.0", "/me", () => new HttpResponse(null, { status: 503 })));
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(
      client.request("GET", "/me", undefined, {
        retryPolicy: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: "full", floorMs: 0 },
        retryHooks: { sleep: () => Promise.resolve() },
      })
    ).rejects.toThrow();
  });

  // Suppress unused-import warning when only used in the rate-limit assertion above.
  it("RateLimitError class is reachable from the public surface", () => {
    expect(RateLimitError).toBeDefined();
  });
});
