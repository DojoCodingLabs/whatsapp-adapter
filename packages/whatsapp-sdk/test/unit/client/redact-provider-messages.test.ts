import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { redactProviderMessage } from "../../../src/client/redact-provider-messages.js";
import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { MockWhatsAppClient } from "../../../src/mock/client.js";
import { InMemoryStorage } from "../../../src/storage/index.js";
import {
  CapabilityError,
  NetworkError,
  RateLimitError,
  UndeliverableError,
  WhatsAppError,
  WindowClosedError,
} from "../../../src/types/errors.js";
import { WindowTracker } from "../../../src/window/tracker.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const VALID = {
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
const PHONE = "15551234567";

function metaError(status: number, error: Record<string, unknown>): void {
  server.use(
    http.post("https://graph.facebook.com/v26.0/PNID/messages", () =>
      HttpResponse.json({ error }, { status })
    )
  );
}

async function sendErr(client: WhatsAppClient): Promise<WhatsAppError> {
  return (await client
    .sendText({ to: PHONE, body: "hi" }, { retryPolicy: NO_RETRY })
    .catch((e: unknown) => e)) as WhatsAppError;
}

describe("redactProviderMessages option", () => {
  const capability = {
    code: 100,
    message: `(#100) Invalid parameter: recipient ${PHONE} is malformed`,
    fbtrace_id: "X",
  };

  it("defaults to false: Meta's text is preserved (non-breaking)", async () => {
    metaError(400, capability);
    const client = new WhatsAppClient({ ...VALID });
    expect(client.redactProviderMessages).toBe(false);
    const err = await sendErr(client);
    expect(err).toBeInstanceOf(CapabilityError);
    expect(err.message).toContain(PHONE);
  });

  it("replaces provider text but keeps class, code and metaCode", async () => {
    metaError(400, capability);
    const err = await sendErr(new WhatsAppClient({ ...VALID, redactProviderMessages: true }));
    expect(err).toBeInstanceOf(CapabilityError);
    expect(err.code).toBe("CAPABILITY");
    expect((err as CapabilityError).metaCode).toBe(100);
    expect(err.message).toBe(
      "WhatsApp Cloud API error (Meta code 100); provider message redacted."
    );
    expect(err.stack ?? "").not.toContain(PHONE);
    expect(JSON.stringify(err)).not.toContain(PHONE);
  });

  it("rate-limit errors keep metaCode for retry branching", async () => {
    metaError(400, { code: 131056, message: `Pair rate limit hit for ${PHONE}` });
    const err = await sendErr(new WhatsAppClient({ ...VALID, redactProviderMessages: true }));
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).metaCode).toBe(131056);
    expect(err.message).not.toContain(PHONE);
  });

  it.each([
    [131047, WindowClosedError],
    [131026, UndeliverableError],
  ] as const)("Meta %i: message and toJSON() never carry the recipient", async (code, Cls) => {
    metaError(400, {
      code,
      message: `Message failed to send to ${PHONE}`,
      error_data: { messaging_product: "whatsapp", details: "x", recipient_phone_number: PHONE },
    });
    const err = await sendErr(new WhatsAppClient({ ...VALID, redactProviderMessages: true }));
    expect(err).toBeInstanceOf(Cls);
    expect(err.message).not.toContain(PHONE);
    expect(JSON.stringify(err)).not.toContain(PHONE);
    expect(JSON.stringify(err.toJSON())).not.toContain(PHONE);
    expect((err as WindowClosedError).customerWaId).toBe("***4567");
  });

  it("pre-flight WindowClosedError is redacted on both clients", async () => {
    const tracker = new WindowTracker({ phoneNumberId: "PNID", storage: new InMemoryStorage() });
    const real = new WhatsAppClient({
      ...VALID,
      windowTracker: tracker,
      redactProviderMessages: true,
    });
    const mock = new MockWhatsAppClient({
      phoneNumberId: "PNID",
      wabaId: "WABA",
      windowTracker: tracker,
      redactProviderMessages: true,
    });
    for (const c of [real, mock]) {
      const err = await c.sendText({ to: PHONE, body: "hi" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WindowClosedError);
      expect((err as Error).message).not.toContain(PHONE);
      expect(JSON.stringify(err)).not.toContain(PHONE);
    }
  });
});

describe("redactProviderMessage()", () => {
  it("leaves SDK-authored errors and non-WhatsAppErrors untouched", () => {
    const net = new NetworkError("Network request to Graph API failed: fetch failed");
    expect(redactProviderMessage(net).message).toBe(
      "Network request to Graph API failed: fetch failed"
    );
    const plain = new Error(`x ${PHONE}`);
    expect(redactProviderMessage(plain).message).toContain(PHONE);
  });

  it("redacts the UNKNOWN fallback (raw Graph body)", () => {
    const err = new WhatsAppError("UNKNOWN", `Graph API 400 (#999): bad ${PHONE}`);
    expect(redactProviderMessage(err).message).not.toContain(PHONE);
  });
});
