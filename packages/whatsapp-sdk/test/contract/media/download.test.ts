import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { fetchMediaUrl } from "../../../src/media/download.js";
import { hashPhoneNumberId } from "../../../src/observability/redact.js";
import {
  MediaExpiredError,
  RateLimitError,
  RequestAbortedError,
  TransientError,
  WhatsAppError,
} from "../../../src/types/errors.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
beforeAll(() => provider.register());
afterAll(() => trace.disable());
beforeEach(() => exporter.reset());

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

const MEDIA_ID = "1013859600285441";
const LOOKUP_URL = `https://graph.facebook.com/v25.0/${MEDIA_ID}`;
// Realistic CDN shape: signed query string that must never reach a span.
const CDN_URL =
  "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1013859600285441&ext=1735689900&hash=ATtSECRETSIG";

function lookupOk(): void {
  server.use(
    http.get(LOOKUP_URL, () =>
      HttpResponse.json(
        {
          url: CDN_URL,
          mime_type: "image/jpeg",
          sha256: "abc123",
          file_size: "3",
          id: MEDIA_ID,
          messaging_product: "whatsapp",
        },
        { status: 200 }
      )
    )
  );
}

describe("WhatsAppClient.downloadMedia (HTTP contract)", () => {
  it("GET /{media-id} → camelCase MediaInfo, then fetchBytes GETs the CDN URL with the bearer", async () => {
    lookupOk();
    let cdnAuth: string | null = null;
    let cdnRequestId: string | null = null;
    server.use(
      http.get("https://lookaside.fbsbx.com/whatsapp_business/attachments/", ({ request }) => {
        cdnAuth = request.headers.get("authorization");
        cdnRequestId = request.headers.get("x-request-id");
        return new HttpResponse(new Uint8Array([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      })
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const media = await client.downloadMedia(MEDIA_ID, { retryPolicy: NO_RETRY });
    expect(media).toMatchObject({
      id: MEDIA_ID,
      mimeType: "image/jpeg",
      sha256: "abc123",
      fileSize: 3,
      url: CDN_URL,
    });

    const bytes = await media.fetchBytes({ requestId: "corr-1" });
    expect(Array.from(bytes)).toEqual([0xff, 0xd8, 0xff]);
    expect(cdnAuth).toBe("Bearer TOKEN-VALUE");
    expect(cdnRequestId).toBe("corr-1");
  });

  it("emits a whatsapp.media.fetch span with host only — no signed query string, no token", async () => {
    lookupOk();
    server.use(
      http.get("https://lookaside.fbsbx.com/whatsapp_business/attachments/", () =>
        HttpResponse.arrayBuffer(new Uint8Array([1]).buffer, { status: 200 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const media = await client.downloadMedia(MEDIA_ID, { retryPolicy: NO_RETRY });
    exporter.reset();
    await media.fetchBytes({ retryPolicy: NO_RETRY });

    const span = exporter.getFinishedSpans().find((s) => s.name === "whatsapp.media.fetch");
    expect(span).toBeDefined();
    expect(span!.attributes["whatsapp.method"]).toBe("GET");
    expect(span!.attributes["whatsapp.media.host"]).toBe("lookaside.fbsbx.com");
    expect(span!.attributes["whatsapp.phone_number_id"]).toBe(await hashPhoneNumberId("PNID"));
    expect(span!.attributes["whatsapp.retry.count"]).toBe(0);
    for (const v of Object.values(span!.attributes)) {
      const s = typeof v === "string" ? v : "";
      expect(s).not.toContain("hash=");
      expect(s).not.toContain("ATtSECRETSIG");
      expect(s).not.toContain("TOKEN-VALUE");
      expect(s).not.toContain("PNID");
    }
  });

  it.each([401, 403, 404, 410])(
    "CDN %i → MediaExpiredError carrying httpStatus + mediaId, no retry",
    async (status) => {
      lookupOk();
      let hits = 0;
      server.use(
        http.get("https://lookaside.fbsbx.com/whatsapp_business/attachments/", () => {
          hits += 1;
          return HttpResponse.text("expired", { status });
        })
      );
      const client = new WhatsAppClient({ ...VALID_OPTIONS });
      const media = await client.downloadMedia(MEDIA_ID, { retryPolicy: NO_RETRY });
      const err = await media
        .fetchBytes({ retryPolicy: { ...NO_RETRY, maxAttempts: 3 } })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MediaExpiredError);
      expect((err as MediaExpiredError).code).toBe("MEDIA_EXPIRED");
      expect((err as MediaExpiredError).httpStatus).toBe(status);
      expect((err as MediaExpiredError).mediaId).toBe(MEDIA_ID);
      expect((err as MediaExpiredError).message).not.toContain("hash=");
      expect(hits).toBe(1);
    }
  );

  it("CDN 503 is retried with the inherited retry policy and surfaces TransientError on exhaustion", async () => {
    lookupOk();
    let hits = 0;
    server.use(
      http.get("https://lookaside.fbsbx.com/whatsapp_business/attachments/", () => {
        hits += 1;
        return HttpResponse.text("busy", { status: 503 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const media = await client.downloadMedia(MEDIA_ID, {
      retryPolicy: { ...NO_RETRY, maxAttempts: 3 },
      retryHooks: { sleep: async () => {} },
    });
    const err = await media.fetchBytes().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientError);
    expect((err as TransientError).httpStatus).toBe(503);
    expect(hits).toBe(3);
    const span = exporter.getFinishedSpans().find((s) => s.name === "whatsapp.media.fetch");
    expect(span!.attributes["whatsapp.retry.count"]).toBe(2);
    expect(span!.attributes["whatsapp.error.code"]).toBe("TRANSIENT");
  });

  it("CDN 429 honours Retry-After and surfaces RateLimitError", async () => {
    lookupOk();
    const sleeps: number[] = [];
    server.use(
      http.get("https://lookaside.fbsbx.com/whatsapp_business/attachments/", () =>
        HttpResponse.text("slow down", { status: 429, headers: { "retry-after": "2" } })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const media = await client.downloadMedia(MEDIA_ID, { retryPolicy: NO_RETRY });
    const err = await media
      .fetchBytes({
        retryPolicy: { ...NO_RETRY, maxAttempts: 2, maxDelayMs: 10_000 },
        retryHooks: {
          sleep: async (ms) => {
            sleeps.push(ms);
          },
        },
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(2000);
    expect(sleeps).toEqual([2000]);
  });

  it("caller abort surfaces RequestAbortedError", async () => {
    lookupOk();
    server.use(
      http.get("https://lookaside.fbsbx.com/whatsapp_business/attachments/", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.arrayBuffer(new Uint8Array([1]).buffer, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const media = await client.downloadMedia(MEDIA_ID, { retryPolicy: NO_RETRY });
    const ac = new AbortController();
    const pending = media.fetchBytes({ signal: ac.signal, retryPolicy: NO_RETRY });
    ac.abort();
    await expect(pending).rejects.toBeInstanceOf(RequestAbortedError);
  });

  it("honours a fetchImpl override on both steps", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.startsWith("https://graph.facebook.com/")) {
        return new Response(
          JSON.stringify({
            url: CDN_URL,
            mime_type: "audio/ogg",
            sha256: "x",
            file_size: 2,
            id: MEDIA_ID,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(new Uint8Array([7, 8]), { status: 200 });
    };
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const media = await client.downloadMedia(MEDIA_ID, { retryPolicy: NO_RETRY, fetchImpl });
    const bytes = await media.fetchBytes();
    expect(Array.from(bytes)).toEqual([7, 8]);
    expect(calls).toEqual([LOOKUP_URL, CDN_URL]);
  });

  it("rejects an empty mediaId with WhatsAppError(UNKNOWN) before any HTTP call", async () => {
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const err = await client.downloadMedia("", { retryPolicy: NO_RETRY }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as WhatsAppError).code).toBe("UNKNOWN");
  });

  it("rejects a lookup response without `url` with WhatsAppError(UNKNOWN)", async () => {
    server.use(
      http.get(LOOKUP_URL, () => HttpResponse.json({ id: MEDIA_ID, mime_type: "image/jpeg" }))
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const err = await client
      .downloadMedia(MEDIA_ID, { retryPolicy: NO_RETRY })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect((err as WhatsAppError).code).toBe("UNKNOWN");
  });
});

describe("fetchMediaUrl (stand-alone)", () => {
  it("accepts a bare AbortSignal as the third argument (0.9.x compatibility)", async () => {
    server.use(
      http.get("https://lookaside.fbsbx.com/whatsapp_business/attachments/", () =>
        HttpResponse.arrayBuffer(new Uint8Array([9]).buffer, { status: 200 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const bytes = await fetchMediaUrl(client, CDN_URL, new AbortController().signal);
    expect(Array.from(bytes)).toEqual([9]);
  });

  it("CDN 404 on a bare URL → MediaExpiredError with mediaId undefined", async () => {
    server.use(
      http.get("https://lookaside.fbsbx.com/whatsapp_business/attachments/", () =>
        HttpResponse.text("gone", { status: 404 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const err = await fetchMediaUrl(client, CDN_URL, { retryPolicy: NO_RETRY }).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(MediaExpiredError);
    expect((err as MediaExpiredError).mediaId).toBeUndefined();
  });

  it("rejects an empty url with WhatsAppError(UNKNOWN)", async () => {
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(fetchMediaUrl(client, "")).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});
