import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { MEDIA_MAX_BYTES } from "../../../src/media/types.js";
import { CapabilityError, TransientError, WhatsAppError } from "../../../src/types/errors.js";

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

const UPLOAD_URL = "https://graph.facebook.com/v25.0/PNID/media";

describe("WhatsAppClient.uploadMedia (HTTP contract)", () => {
  it("POSTs multipart/form-data with messaging_product, type and file to /{phone-number-id}/media", async () => {
    let seenContentType: string | null = null;
    let seenAuth: string | null = null;
    let seenForm: FormData | null = null;
    server.use(
      http.post(UPLOAD_URL, async ({ request }) => {
        seenContentType = request.headers.get("content-type");
        seenAuth = request.headers.get("authorization");
        seenForm = await request.formData();
        return HttpResponse.json({ id: "MEDIA-123" }, { status: 200 });
      })
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const res = await client.uploadMedia(
      { file: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpeg", filename: "a.jpg" },
      { retryPolicy: NO_RETRY }
    );

    expect(res).toEqual({ id: "MEDIA-123" });
    expect(seenAuth).toBe("Bearer TOKEN-VALUE");
    // fetch infers the multipart boundary — the SDK must NOT force JSON.
    expect(seenContentType ?? "").toMatch(/^multipart\/form-data; boundary=/);
    const form = seenForm as FormData | null;
    expect(form).not.toBeNull();
    expect(form!.get("messaging_product")).toBe("whatsapp");
    expect(form!.get("type")).toBe("image/jpeg");
    const file = form!.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).size).toBe(3);
    expect((file as Blob).type).toBe("image/jpeg");
  });

  it("rejects an oversize image BEFORE any HTTP call with WhatsAppError(CAPABILITY)", async () => {
    let hits = 0;
    server.use(
      http.post(UPLOAD_URL, () => {
        hits += 1;
        return HttpResponse.json({ id: "never" }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const oversize = new Uint8Array(MEDIA_MAX_BYTES.image + 1);
    const err = await client
      .uploadMedia({ file: oversize, mimeType: "image/jpeg" }, { retryPolicy: NO_RETRY })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect((err as WhatsAppError).code).toBe("CAPABILITY");
    expect(hits).toBe(0);
  });

  it("rejects a malformed input with WhatsAppError(UNKNOWN), never a bare TypeError", async () => {
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const err = await client
      .uploadMedia({ file: new Uint8Array([1]), mimeType: "" }, { retryPolicy: NO_RETRY })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as WhatsAppError).code).toBe("UNKNOWN");
  });

  it("maps a Meta 400 on upload through mapMetaError (code 100 → CapabilityError)", async () => {
    server.use(
      http.post(UPLOAD_URL, () =>
        HttpResponse.json(
          {
            error: { message: "(#100) Unsupported media type", type: "OAuthException", code: 100 },
          },
          { status: 400 }
        )
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(
      client.uploadMedia(
        { file: new Uint8Array([1]), mimeType: "application/x-unknown" },
        { retryPolicy: NO_RETRY }
      )
    ).rejects.toBeInstanceOf(CapabilityError);
  });

  it("retries a 503 and surfaces TransientError when the retry budget is exhausted", async () => {
    let hits = 0;
    server.use(
      http.post(UPLOAD_URL, () => {
        hits += 1;
        return HttpResponse.text("upstream unavailable", { status: 503 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const err = await client
      .uploadMedia(
        { file: new Uint8Array([1]), mimeType: "image/png" },
        { retryPolicy: { ...NO_RETRY, maxAttempts: 2 }, retryHooks: { sleep: async () => {} } }
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientError);
    expect(hits).toBe(2);
  });
});
