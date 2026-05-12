import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";

/**
 * `whatsapp.retry.{count,reason}` span-attribute contract.
 * Asserts the SDK surfaces retry telemetry on every
 * `whatsapp.request` span — both success and final-failure
 * paths — and uses the canonical `RetryReason` discriminator.
 */

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
  provider.register();
});
afterAll(() => trace.disable());
beforeEach(() => exporter.reset());

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

const NO_RETRY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitter: "full" as const,
  floorMs: 0,
};

function reqSpan() {
  const spans = exporter.getFinishedSpans();
  const s = spans.find((x) => x.name === "whatsapp.request");
  if (!s) throw new Error("no whatsapp.request span emitted");
  return s;
}

describe("whatsapp.request — retry telemetry", () => {
  it("first-attempt success: count = 0, reason absent", async () => {
    server.use(
      http.get("https://graph.facebook.com/v25.0/me", () =>
        HttpResponse.json({ ok: true }, { status: 200 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, { retryPolicy: NO_RETRY });

    const span = reqSpan();
    expect(span.attributes["whatsapp.retry.count"]).toBe(0);
    expect(span.attributes["whatsapp.retry.reason"]).toBeUndefined();
  });

  it("two 503 retries then success: count = 2, reason = transient_http", async () => {
    let calls = 0;
    server.use(
      http.get("https://graph.facebook.com/v25.0/me", () => {
        calls += 1;
        if (calls < 3) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, {
      retryPolicy: FAST_RETRY,
      retryHooks: { sleep: () => Promise.resolve() },
    });

    const span = reqSpan();
    expect(span.attributes["whatsapp.retry.count"]).toBe(2);
    expect(span.attributes["whatsapp.retry.reason"]).toBe("transient_http");
  });

  it("a 429 retry: reason = rate_limit", async () => {
    let calls = 0;
    server.use(
      http.get("https://graph.facebook.com/v25.0/me", () => {
        calls += 1;
        if (calls < 2) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, {
      retryPolicy: FAST_RETRY,
      retryHooks: { sleep: () => Promise.resolve() },
    });

    const span = reqSpan();
    expect(span.attributes["whatsapp.retry.count"]).toBe(1);
    expect(span.attributes["whatsapp.retry.reason"]).toBe("rate_limit");
  });

  it("a 130429 (Meta business rate-limit) retry: reason = rate_limit", async () => {
    let calls = 0;
    server.use(
      http.post("https://graph.facebook.com/v25.0/PNID/messages", () => {
        calls += 1;
        if (calls < 2) {
          return HttpResponse.json(
            { error: { code: 130429, message: "rate limited" } },
            { status: 400 }
          );
        }
        return HttpResponse.json({ messages: [{ id: "wamid.x" }] }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request(
      "POST",
      "PNID/messages",
      { msg: "x" },
      {
        retryPolicy: FAST_RETRY,
        retryHooks: { sleep: () => Promise.resolve() },
      }
    );

    const span = reqSpan();
    expect(span.attributes["whatsapp.retry.count"]).toBe(1);
    expect(span.attributes["whatsapp.retry.reason"]).toBe("rate_limit");
  });

  it("final-failure path also records retry attributes", async () => {
    server.use(
      http.get("https://graph.facebook.com/v25.0/me", () => new HttpResponse(null, { status: 503 }))
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(
      client.request("GET", "/me", undefined, {
        retryPolicy: FAST_RETRY,
        retryHooks: { sleep: () => Promise.resolve() },
      })
    ).rejects.toThrow();

    const span = reqSpan();
    // maxAttempts = 4 → 3 retries before the final failure
    expect(span.attributes["whatsapp.retry.count"]).toBe(3);
    expect(span.attributes["whatsapp.retry.reason"]).toBe("transient_http");
  });
});
