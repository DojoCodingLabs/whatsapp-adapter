import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../src/client/whatsapp-client.js";
import { MEDIA_MAX_BYTES } from "../../src/media/types.js";
import { buildText } from "../../src/messages/builders.js";
import { MockWhatsAppClient } from "../../src/mock/client.js";
import type { WhatsAppLikeClient } from "../../src/mock/types.js";
import { WhatsAppError } from "../../src/types/errors.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const PNID = "PNID";
const WABA = "WABA";

const REAL_OPTIONS = {
  phoneNumberId: PNID,
  wabaId: WABA,
  token: "TOKEN",
  appSecret: "APP-SECRET",
} as const;

const NO_RETRY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitter: "full" as const,
  floorMs: 0,
};

const CDN_URL = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1&hash=x";

function stubRealMediaEndpoints(): void {
  server.use(
    http.post("https://graph.facebook.com/v25.0/PNID/media", () =>
      HttpResponse.json({ id: "MEDIA-REAL" }, { status: 200 })
    ),
    http.get("https://graph.facebook.com/v25.0/MEDIA-REAL", () =>
      HttpResponse.json(
        { url: CDN_URL, mime_type: "image/jpeg", sha256: "s", file_size: 4, id: "MEDIA-REAL" },
        { status: 200 }
      )
    ),
    http.get("https://lookaside.fbsbx.com/whatsapp_business/attachments/", () =>
      HttpResponse.arrayBuffer(new Uint8Array(4).buffer, { status: 200 })
    ),
    http.post("https://graph.facebook.com/v25.0/PNID/messages", () =>
      HttpResponse.json({ success: true }, { status: 200 })
    )
  );
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return err instanceof WhatsAppError ? err.code : `non-WhatsAppError:${String(err)}`;
  }
}

/**
 * Runs the same scenario on both clients and asserts the observable
 * outcome (resolved shape or thrown `WhatsAppError.code`) matches.
 */
async function bothClients<T>(
  run: (c: WhatsAppLikeClient) => Promise<T>
): Promise<{ real: T | string | undefined; mock: T | string | undefined }> {
  stubRealMediaEndpoints();
  const real = new WhatsAppClient({ ...REAL_OPTIONS });
  const mock = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
  const settle = async (c: WhatsAppLikeClient): Promise<T | string | undefined> => {
    try {
      return await run(c);
    } catch (err) {
      return err instanceof WhatsAppError ? err.code : `non-WhatsAppError:${String(err)}`;
    }
  };
  return { real: await settle(real), mock: await settle(mock) };
}

describe("parity: media + acks behave the same on real and mock clients", () => {
  it("uploadMedia resolves { id } on both", async () => {
    const { real, mock } = await bothClients((c) =>
      c.uploadMedia({ file: new Uint8Array(4), mimeType: "image/jpeg" }, { retryPolicy: NO_RETRY })
    );
    expect(typeof (real as { id: string }).id).toBe("string");
    expect(typeof (mock as { id: string }).id).toBe("string");
  });

  it("uploadMedia rejects an oversize image with CAPABILITY on both (no HTTP on the real side)", async () => {
    const oversize = new Uint8Array(MEDIA_MAX_BYTES.image + 1);
    const { real, mock } = await bothClients((c) =>
      c.uploadMedia({ file: oversize, mimeType: "image/jpeg" }, { retryPolicy: NO_RETRY })
    );
    expect(real).toBe("CAPABILITY");
    expect(mock).toBe("CAPABILITY");
  });

  it("uploadMedia rejects an empty mimeType with UNKNOWN on both", async () => {
    const { real, mock } = await bothClients((c) =>
      c.uploadMedia({ file: new Uint8Array(1), mimeType: "" }, { retryPolicy: NO_RETRY })
    );
    expect(real).toBe("UNKNOWN");
    expect(mock).toBe("UNKNOWN");
  });

  it("downloadMedia after uploadMedia yields the same MediaInfo shape and fetchBytes length", async () => {
    const { real, mock } = await bothClients(async (c) => {
      const { id } = await c.uploadMedia(
        { file: new Uint8Array(4), mimeType: "image/jpeg" },
        { retryPolicy: NO_RETRY }
      );
      const info = await c.downloadMedia(id, { retryPolicy: NO_RETRY });
      const bytes = await info.fetchBytes({ retryPolicy: NO_RETRY });
      return {
        keys: Object.keys(info)
          .filter((k) => k !== "fetchBytes")
          .sort(),
        mimeType: info.mimeType,
        fileSize: info.fileSize,
        byteLength: bytes.byteLength,
      };
    });
    expect(real).toEqual(mock);
    expect(real).toEqual({
      keys: ["fileSize", "id", "mimeType", "sha256", "url"],
      mimeType: "image/jpeg",
      fileSize: 4,
      byteLength: 4,
    });
  });

  it("downloadMedia('') rejects with UNKNOWN on both", async () => {
    const { real, mock } = await bothClients((c) => c.downloadMedia("", { retryPolicy: NO_RETRY }));
    expect(real).toBe("UNKNOWN");
    expect(mock).toBe("UNKNOWN");
  });

  it("markAsRead resolves { success: true } on both and rejects an empty wamid with UNKNOWN", async () => {
    const ok = await bothClients((c) =>
      c.markAsRead({ messageId: "wamid.X", typing: true }, { retryPolicy: NO_RETRY })
    );
    expect(ok.real).toEqual({ success: true });
    expect(ok.mock).toEqual({ success: true });

    const bad = await bothClients((c) =>
      c.markAsRead({ messageId: "" }, { retryPolicy: NO_RETRY })
    );
    expect(bad.real).toBe("UNKNOWN");
    expect(bad.mock).toBe("UNKNOWN");
  });

  it("sendReply('') rejects with UNKNOWN on both — never a bare Error", async () => {
    const payload = buildText({ to: "521234567890", body: "x" });
    const real = new WhatsAppClient({ ...REAL_OPTIONS });
    const mock = new MockWhatsAppClient({ phoneNumberId: PNID, wabaId: WABA });
    expect(await codeOf(real.sendReply("", payload, { retryPolicy: NO_RETRY }))).toBe("UNKNOWN");
    expect(await codeOf(mock.sendReply("", payload))).toBe("UNKNOWN");
  });
});
