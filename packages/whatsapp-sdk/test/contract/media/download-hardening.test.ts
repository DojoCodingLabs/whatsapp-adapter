import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { fetchMediaUrl } from "../../../src/media/download.js";
import { MediaTooLargeError, UntrustedMediaUrlError } from "../../../src/media/errors.js";
import { CapabilityError } from "../../../src/types/errors.js";

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

const MEDIA_ID = "1013859600285441";
const CDN_PATH = "https://lookaside.fbsbx.com/whatsapp_business/attachments/";
const CDN_URL = `${CDN_PATH}?mid=${MEDIA_ID}&ext=1735689900&hash=ATtSECRETSIG`;

function lookup(fileSize: number, url = CDN_URL): void {
  server.use(
    http.get(`https://graph.facebook.com/v26.0/${MEDIA_ID}`, () =>
      HttpResponse.json({
        url,
        mime_type: "image/jpeg",
        sha256: "abc",
        file_size: fileSize,
        id: MEDIA_ID,
        messaging_product: "whatsapp",
      })
    )
  );
}

describe("media download: maxBytes", () => {
  it("rejects before any CDN request when Meta's file_size exceeds maxBytes", async () => {
    lookup(2048);
    let cdnHits = 0;
    server.use(
      http.get(CDN_PATH, () => {
        cdnHits += 1;
        return HttpResponse.arrayBuffer(new Uint8Array(2048).buffer);
      })
    );
    const client = new WhatsAppClient({ ...VALID });
    const media = await client.downloadMedia(MEDIA_ID, { retryPolicy: NO_RETRY, maxBytes: 1024 });
    const err = await media.fetchBytes().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MediaTooLargeError);
    expect(err).toBeInstanceOf(CapabilityError);
    expect((err as MediaTooLargeError).maxBytes).toBe(1024);
    expect((err as MediaTooLargeError).actualBytes).toBe(2048);
    expect(cdnHits).toBe(0);
  });

  it("rejects an oversized Content-Length without buffering the body", async () => {
    server.use(
      http.get(CDN_PATH, () =>
        HttpResponse.arrayBuffer(new Uint8Array(4096).buffer, {
          headers: { "content-length": "4096" },
        })
      )
    );
    const client = new WhatsAppClient({ ...VALID });
    const err = await fetchMediaUrl(client, CDN_URL, {
      retryPolicy: NO_RETRY,
      maxBytes: 100,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MediaTooLargeError);
    expect((err as MediaTooLargeError).actualBytes).toBe(4096);
  });

  it("cancels a streamed body (no Content-Length) once it overruns maxBytes", async () => {
    let pulled = 0;
    server.use(
      http.get(CDN_PATH, () => {
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            if (pulled > 1000) {
              controller.close();
              return;
            }
            controller.enqueue(new Uint8Array(64));
          },
        });
        return new HttpResponse(stream, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID });
    const err = await fetchMediaUrl(client, CDN_URL, {
      retryPolicy: NO_RETRY,
      maxBytes: 200,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MediaTooLargeError);
    expect((err as MediaTooLargeError).actualBytes).toBeGreaterThan(200);
    expect(pulled).toBeLessThan(1000);
  });

  it("a body within maxBytes is returned intact", async () => {
    server.use(
      http.get(CDN_PATH, () => HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer))
    );
    const client = new WhatsAppClient({ ...VALID });
    const bytes = await fetchMediaUrl(client, CDN_URL, { retryPolicy: NO_RETRY, maxBytes: 3 });
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});

describe("media download: bearer token only to https Meta hosts", () => {
  it.each([
    ["http (plaintext)", "http://lookaside.fbsbx.com/x?hash=S", "insecure_scheme"],
    ["foreign host", "https://evil.example/x?hash=S", "untrusted_host"],
    ["look-alike host", "https://fbsbx.com.evil.example/x", "untrusted_host"],
    ["not a URL", "not a url", "invalid_url"],
  ] as const)("refuses %s before any request", async (_label, url, reason) => {
    let seenAuth: string | null = null;
    server.use(
      http.all("*", ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.text("x");
      })
    );
    const client = new WhatsAppClient({ ...VALID });
    const err = await fetchMediaUrl(client, url, { retryPolicy: NO_RETRY }).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(UntrustedMediaUrlError);
    expect((err as UntrustedMediaUrlError).reason).toBe(reason);
    expect((err as UntrustedMediaUrlError).message).not.toContain("hash=");
    expect(seenAuth).toBeNull();
  });

  it("a Meta lookup returning a non-Meta URL is refused at fetchBytes()", async () => {
    lookup(3, "https://attacker.example/steal");
    const client = new WhatsAppClient({ ...VALID });
    const media = await client.downloadMedia(MEDIA_ID, { retryPolicy: NO_RETRY });
    await expect(media.fetchBytes()).rejects.toBeInstanceOf(UntrustedMediaUrlError);
  });

  it("does not follow a redirect to a non-Meta host with the token", async () => {
    let attackerAuth: string | null | undefined;
    server.use(
      http.get(
        CDN_PATH,
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { location: "https://attacker.example/x" },
          })
      ),
      http.get("https://attacker.example/x", ({ request }) => {
        attackerAuth = request.headers.get("authorization");
        return HttpResponse.text("stolen");
      })
    );
    const client = new WhatsAppClient({ ...VALID });
    const err = await fetchMediaUrl(client, CDN_URL, { retryPolicy: NO_RETRY }).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(UntrustedMediaUrlError);
    expect((err as UntrustedMediaUrlError).reason).toBe("untrusted_host");
    expect(attackerAuth).toBeUndefined();
  });

  it("does not follow a redirect downgrading to http", async () => {
    server.use(
      http.get(
        CDN_PATH,
        () =>
          new HttpResponse(null, {
            status: 307,
            headers: { location: "http://scontent.xx.fbcdn.net/v/t.jpg" },
          })
      )
    );
    const client = new WhatsAppClient({ ...VALID });
    const err = await fetchMediaUrl(client, CDN_URL, { retryPolicy: NO_RETRY }).catch(
      (e: unknown) => e
    );
    expect((err as UntrustedMediaUrlError).reason).toBe("insecure_scheme");
  });

  it("follows a redirect to another Meta CDN host (re-validated)", async () => {
    let cdnAuth: string | null = null;
    server.use(
      http.get(
        CDN_PATH,
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { location: "https://scontent.xx.fbcdn.net/v/t.jpg" },
          })
      ),
      http.get("https://scontent.xx.fbcdn.net/v/t.jpg", ({ request }) => {
        cdnAuth = request.headers.get("authorization");
        return HttpResponse.arrayBuffer(new Uint8Array([5]).buffer);
      })
    );
    const client = new WhatsAppClient({ ...VALID });
    const bytes = await fetchMediaUrl(client, CDN_URL, { retryPolicy: NO_RETRY });
    expect(Array.from(bytes)).toEqual([5]);
    expect(cdnAuth).toBe("Bearer TOKEN-VALUE");
  });

  it("isTrustedMediaHost overrides the host allowlist (https still required)", async () => {
    server.use(
      http.get("https://media.test.local/x", () =>
        HttpResponse.arrayBuffer(new Uint8Array([4]).buffer)
      )
    );
    const client = new WhatsAppClient({ ...VALID });
    const bytes = await fetchMediaUrl(client, "https://media.test.local/x", {
      retryPolicy: NO_RETRY,
      isTrustedMediaHost: (h) => h === "media.test.local",
    });
    expect(Array.from(bytes)).toEqual([4]);
    await expect(
      fetchMediaUrl(client, "http://media.test.local/x", {
        isTrustedMediaHost: () => true,
      })
    ).rejects.toMatchObject({ reason: "insecure_scheme" });
  });
});

describe("media download: mediaId is path-encoded", () => {
  it("an id carrying `?`/`/` cannot reach another Graph endpoint", async () => {
    let seenPath: string | undefined;
    server.use(
      http.get("https://graph.facebook.com/*", ({ request }) => {
        const u = new URL(request.url);
        seenPath = u.pathname + u.search;
        return HttpResponse.json({ error: { code: 100, message: "bad" } }, { status: 400 });
      })
    );
    const client = new WhatsAppClient({ ...VALID });
    await client
      .downloadMedia("123?fields=access_token", { retryPolicy: NO_RETRY })
      .catch(() => {});
    expect(seenPath).toBe("/v26.0/123%3Ffields%3Daccess_token");
    await client.downloadMedia("../me", { retryPolicy: NO_RETRY }).catch(() => {});
    expect(seenPath).toBe("/v26.0/..%2Fme");
  });
});
