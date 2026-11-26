import { readFileSync } from "node:fs";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { TransientHttpError } from "../../../src/client/retry.js";
import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import {
  AccountRestrictedError,
  RateLimitError,
  TemplateError,
  TransientError,
  UndeliverableError,
  type WhatsAppError,
} from "../../../src/types/errors.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../__fixtures__/errors/${name}.json`, import.meta.url), "utf8")
  ) as unknown;
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const OPTIONS = {
  phoneNumberId: "PNID",
  wabaId: "WABA",
  token: "TOKEN-VALUE",
  appSecret: "APP-SECRET-VALUE",
} as const;

const FOUR_ATTEMPTS = {
  retryPolicy: {
    maxAttempts: 4,
    baseDelayMs: 0,
    maxDelayMs: 0,
    jitter: "full" as const,
    floorMs: 0,
  },
  retryHooks: { sleep: (): Promise<void> => Promise.resolve() },
};

function respondWith(status: number, body: unknown, headers: Record<string, string> = {}) {
  let calls = 0;
  server.use(
    http.post("https://graph.facebook.com/v26.0/PNID/messages", () => {
      calls += 1;
      return HttpResponse.json(body as Record<string, unknown>, { status, headers });
    })
  );
  return (): number => calls;
}

async function send(client: WhatsAppClient): Promise<unknown> {
  try {
    await client.request(
      "POST",
      "/PNID/messages",
      { messaging_product: "whatsapp" },
      FOUR_ATTEMPTS
    );
  } catch (err) {
    return err;
  }
  throw new Error("expected the request to reject");
}

describe("transport: Meta envelope on a retryable HTTP status", () => {
  it("HTTP 500 carrying 134102 (template unavailable) throws TemplateError once, no retry", async () => {
    const calls = respondWith(500, fixture("134102-template-unavailable"));
    const err = await send(new WhatsAppClient({ ...OPTIONS }));
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as TemplateError).metaCode).toBe(134102);
    expect(err).not.toBeInstanceOf(TransientError);
    expect(calls()).toBe(1);
  });

  it("HTTP 500 carrying 131042 (payment method) throws AccountRestrictedError once", async () => {
    const calls = respondWith(500, {
      error: { code: 131042, message: "(#131042) Business eligibility payment issue" },
    });
    const err = await send(new WhatsAppClient({ ...OPTIONS }));
    expect(err).toBeInstanceOf(AccountRestrictedError);
    expect(calls()).toBe(1);
  });

  it("HTTP 503 carrying 131016 (service unavailable) is retried and surfaces TransientError with metaCode", async () => {
    const calls = respondWith(503, fixture("131016-service-unavailable"));
    const err = await send(new WhatsAppClient({ ...OPTIONS }));
    expect(err).toBeInstanceOf(TransientError);
    const te = err as TransientError;
    expect(te.metaCode).toBe(131016);
    expect(te.httpStatus).toBe(503);
    expect(te.attempts).toBe(4);
    expect((te as unknown as { cause: unknown }).cause).toBeInstanceOf(TransientHttpError);
    expect(calls()).toBe(4);
  });

  it("HTTP 500 carrying an unmapped Meta code keeps the transient behaviour", async () => {
    const calls = respondWith(500, { error: { code: 987654, message: "(#987654) ???" } });
    const err = await send(new WhatsAppClient({ ...OPTIONS }));
    expect(err).toBeInstanceOf(TransientError);
    expect((err as TransientError).httpStatus).toBe(500);
    expect(calls()).toBe(4);
  });

  it("HTTP 429 carrying 131048 (quality throttle) is NOT fast-retried; RateLimitError keeps Retry-After", async () => {
    const calls = respondWith(429, fixture("131048-spam-rate-limit"), { "retry-after": "30" });
    const err = await send(new WhatsAppClient({ ...OPTIONS }));
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).metaCode).toBe(131048);
    expect((err as RateLimitError).retryAfterMs).toBe(30_000);
    expect(calls()).toBe(1);
  });

  it("HTTP 429 carrying 130429 (throughput) is still retried", async () => {
    const calls = respondWith(429, {
      error: { code: 130429, message: "(#130429) Rate limit hit" },
    });
    const err = await send(new WhatsAppClient({ ...OPTIONS }));
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).metaCode).toBe(130429);
    expect(calls()).toBe(4);
  });
});

describe("transport: Meta temporary codes on a 4xx", () => {
  it("HTTP 400 carrying 131000 is retried by the default-shaped policy, then TransientError", async () => {
    const calls = respondWith(400, {
      error: { code: 131000, message: "(#131000) Something went wrong" },
    });
    const err = await send(new WhatsAppClient({ ...OPTIONS }));
    expect(err).toBeInstanceOf(TransientError);
    expect((err as TransientError).metaCode).toBe(131000);
    expect((err as TransientError).httpStatus).toBe(400);
    expect((err as TransientError).attempts).toBe(4);
    expect(calls()).toBe(4);
  });

  it("HTTP 400 carrying 131057 recovers when a later attempt succeeds", async () => {
    let calls = 0;
    server.use(
      http.post("https://graph.facebook.com/v26.0/PNID/messages", () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { error: { code: 131057, message: "(#131057) Account in maintenance mode" } },
            { status: 400 }
          );
        }
        return HttpResponse.json({ messages: [{ id: "wamid.X" }] }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...OPTIONS });
    await expect(
      client.request("POST", "/PNID/messages", { messaging_product: "whatsapp" }, FOUR_ATTEMPTS)
    ).resolves.toEqual({ messages: [{ id: "wamid.X" }] });
    expect(calls).toBe(2);
  });

  it("HTTP 400 carrying 130403 (blocked) throws UndeliverableError once without the number in the message", async () => {
    const body = fixture("130403-recipient-blocked") as { error: Record<string, unknown> };
    body.error["error_data"] = {
      messaging_product: "whatsapp",
      recipient_phone_number: "521234567890",
    };
    const calls = respondWith(400, body);
    const err = await send(new WhatsAppClient({ ...OPTIONS }));
    expect(err).toBeInstanceOf(UndeliverableError);
    expect((err as WhatsAppError).message).not.toContain("521234567890");
    expect(calls()).toBe(1);
  });
});
