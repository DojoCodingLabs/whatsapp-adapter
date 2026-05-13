import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { InMemoryOptInRegistry } from "../../../src/opt-in/in-memory.js";
import { OptOutError } from "../../../src/types/errors.js";

/**
 * Opt-in pre-flight contract for the real WhatsAppClient.
 * Asserts the gate fires BEFORE the HTTP layer — verifiable
 * via MSW handler-count.
 */

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const VALID_OPTIONS = {
  phoneNumberId: "PNID",
  wabaId: "WABA",
  token: "TOKEN",
  appSecret: "APP",
} as const;

describe("WhatsAppClient — opt-in pre-flight", () => {
  it("opted-out recipient: sendTemplate throws OptOutError before HTTP", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001", { category: "MARKETING" });

    let httpHit = 0;
    server.use(
      http.post("https://graph.facebook.com/v25.0/PNID/messages", () => {
        httpHit += 1;
        return HttpResponse.json({ messages: [{ id: "wamid.real" }] }, { status: 200 });
      })
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS, optInRegistry: reg });

    await expect(
      client.sendTemplate({ to: "+5210000000001", name: "promo", language: "es_MX" })
    ).rejects.toBeInstanceOf(OptOutError);

    expect(httpHit).toBe(0); // pre-flight blocked before HTTP
  });

  it("opted-out recipient: OptOutError has redacted recipient + code", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001");
    const client = new WhatsAppClient({ ...VALID_OPTIONS, optInRegistry: reg });

    try {
      await client.sendTemplate({ to: "+5210000000001", name: "promo", language: "es_MX" });
      throw new Error("expected OptOutError");
    } catch (err) {
      expect(err).toBeInstanceOf(OptOutError);
      const e = err as OptOutError;
      expect(e.code).toBe("OPT_OUT");
      expect(e.recipient).toBe("***0001");
      expect(e.message).not.toContain("+5210000000001"); // no PII leak
      expect(e.message).not.toContain("521000000"); // also no full digits leak
    }
  });

  it("opted-in recipient: sendTemplate proceeds normally", async () => {
    const reg = new InMemoryOptInRegistry();
    // Default state: opted in (no record).
    server.use(
      http.post("https://graph.facebook.com/v25.0/PNID/messages", () =>
        HttpResponse.json({ messages: [{ id: "wamid.real-1" }] }, { status: 200 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS, optInRegistry: reg });
    const result = await client.sendTemplate({
      to: "+5210000000001",
      name: "promo",
      language: "es_MX",
    });
    expect(result.messages[0]?.id).toBe("wamid.real-1");
  });

  it("no registry configured: pre-flight is a no-op", async () => {
    server.use(
      http.post("https://graph.facebook.com/v25.0/PNID/messages", () =>
        HttpResponse.json({ messages: [{ id: "wamid.real-2" }] }, { status: 200 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS }); // no optInRegistry
    const result = await client.sendTemplate({
      to: "+5210000000001",
      name: "promo",
      language: "es_MX",
    });
    expect(result.messages[0]?.id).toBe("wamid.real-2");
  });

  it("sendText does NOT consult the registry", async () => {
    const reg = new InMemoryOptInRegistry();
    const isOptedInSpy = vi.spyOn(reg, "isOptedIn");
    await reg.optOut("+5210000000001"); // global opt-out

    server.use(
      http.post("https://graph.facebook.com/v25.0/PNID/messages", () =>
        HttpResponse.json({ messages: [{ id: "wamid.text-real" }] }, { status: 200 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS, optInRegistry: reg });

    // sendText is window-gated, not opt-in-gated. With no window
    // tracker, the SDK doesn't pre-flight either; the call hits Meta.
    // The registry should NOT be consulted at all.
    isOptedInSpy.mockClear();
    const result = await client.sendText({ to: "+5210000000001", body: "hi" });
    expect(result.messages[0]?.id).toBe("wamid.text-real");
    expect(isOptedInSpy).not.toHaveBeenCalled();
  });

  it("sendAuthTemplate honours the registry with AUTHENTICATION category", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001", { category: "AUTHENTICATION" });

    const client = new WhatsAppClient({ ...VALID_OPTIONS, optInRegistry: reg });

    try {
      await client.sendAuthTemplate({
        to: "+5210000000001",
        name: "otp",
        language: "es_MX",
        otp: "123456",
      });
      throw new Error("expected OptOutError");
    } catch (err) {
      expect(err).toBeInstanceOf(OptOutError);
      const e = err as OptOutError;
      expect(e.category).toBe("AUTHENTICATION");
    }
  });

  it("sendCarouselTemplate honours the registry with MARKETING category", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001", { category: "MARKETING" });
    const client = new WhatsAppClient({ ...VALID_OPTIONS, optInRegistry: reg });

    try {
      await client.sendCarouselTemplate({
        to: "+5210000000001",
        name: "promo-carousel",
        language: "es_MX",
        cards: [
          {
            header: { type: "image", link: "https://example.com/a.jpg" },
          },
        ],
      });
      throw new Error("expected OptOutError");
    } catch (err) {
      expect(err).toBeInstanceOf(OptOutError);
      expect((err as OptOutError).category).toBe("MARKETING");
    }
  });

  it("UTILITY category opt-in does not block when MARKETING is the template category", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001", { category: "UTILITY" });
    // Template default category is MARKETING; UTILITY opt-out doesn't apply.
    server.use(
      http.post("https://graph.facebook.com/v25.0/PNID/messages", () =>
        HttpResponse.json({ messages: [{ id: "wamid.ok" }] }, { status: 200 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS, optInRegistry: reg });
    const result = await client.sendTemplate({
      to: "+5210000000001",
      name: "promo",
      language: "es_MX",
    });
    expect(result.messages[0]?.id).toBe("wamid.ok");
  });
});
