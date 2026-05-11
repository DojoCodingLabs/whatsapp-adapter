import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { hashPhoneNumberId } from "../../../src/observability/redact.js";
import { RateLimitError, WhatsAppError } from "../../../src/types/errors.js";

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
  phoneNumberId: "PNID-real",
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

describe("transport spans", () => {
  it("emits a whatsapp.request span with hashed phone_number_id on success", async () => {
    server.use(
      http.get("https://graph.facebook.com/v25.0/me", () =>
        HttpResponse.json({ id: "1" }, { status: 200 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.request("GET", "/me", undefined, { retryPolicy: NO_RETRY });

    const spans = exporter.getFinishedSpans();
    const reqSpan = spans.find((s) => s.name === "whatsapp.request");
    expect(reqSpan).toBeDefined();
    const hashed = await hashPhoneNumberId("PNID-real");
    expect(reqSpan!.attributes["whatsapp.phone_number_id"]).toBe(hashed);
    // Raw id is NOT in attributes
    for (const v of Object.values(reqSpan!.attributes)) {
      expect(typeof v === "string" ? v : "").not.toContain("PNID-real");
    }
    expect(reqSpan!.attributes["whatsapp.method"]).toBe("GET");
    expect(reqSpan!.attributes["whatsapp.path"]).toBe("/me");
  });

  it("records ERROR status and error.code attribute on a typed failure", async () => {
    server.use(
      http.post("https://graph.facebook.com/v25.0/PNID-real/messages", () =>
        HttpResponse.json(
          { error: { code: 131056, message: "(#131056) pair rate limit" } },
          { status: 400 }
        )
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(
      client.request(
        "POST",
        "/PNID-real/messages",
        { messaging_product: "whatsapp" },
        {
          retryPolicy: NO_RETRY,
        }
      )
    ).rejects.toBeInstanceOf(RateLimitError);

    const reqSpan = exporter.getFinishedSpans().find((s) => s.name === "whatsapp.request");
    expect(reqSpan).toBeDefined();
    expect(reqSpan!.status.code).toBe(2); // ERROR
    expect(reqSpan!.attributes["whatsapp.error.code"]).toBe("RATE_LIMIT");
    expect(reqSpan!.attributes["whatsapp.error.meta_code"]).toBe(131056);
  });

  it("records ERROR for a non-rate-limit WhatsAppError without a meta_code", async () => {
    // Use code 191 (deliberately outside the auth/permission/capability/rate-limit/template sets)
    // so the mapper falls through to WhatsAppError("UNKNOWN", …) — that's the case this test
    // exercises (typed-error span tagging without a Meta meta_code).
    server.use(
      http.post("https://graph.facebook.com/v25.0/PNID-real/messages", () =>
        HttpResponse.json({ error: { code: 191, message: "Other failure" } }, { status: 400 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(
      client.request(
        "POST",
        "/PNID-real/messages",
        { messaging_product: "whatsapp" },
        {
          retryPolicy: NO_RETRY,
        }
      )
    ).rejects.toBeInstanceOf(WhatsAppError);

    const reqSpan = exporter.getFinishedSpans().find((s) => s.name === "whatsapp.request");
    expect(reqSpan).toBeDefined();
    expect(reqSpan!.attributes["whatsapp.error.code"]).toBe("UNKNOWN");
    expect(reqSpan!.attributes["whatsapp.error.meta_code"]).toBeUndefined();
  });
});
