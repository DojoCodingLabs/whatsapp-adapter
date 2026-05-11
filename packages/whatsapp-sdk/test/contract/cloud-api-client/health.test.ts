import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { WhatsAppError } from "../../../src/types/errors.js";

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

describe("WhatsAppClient.healthCheck", () => {
  it("resolves with TokenInfo on a valid token", async () => {
    server.use(
      http.get("https://graph.facebook.com/v25.0/debug_token", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("input_token")).toBe("TOKEN-VALUE");
        return HttpResponse.json(
          {
            data: {
              is_valid: true,
              expires_at: 1735689600,
              app_id: "APP",
              user_id: "USR",
              scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
            },
          },
          { status: 200 }
        );
      })
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const info = await client.healthCheck({ retryPolicy: NO_RETRY });

    expect(info).toEqual({
      valid: true,
      expiresAt: 1735689600 * 1000,
      appId: "APP",
      userId: "USR",
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
    });
  });

  it("returns expiresAt = null when Meta returns 0 / omits the field", async () => {
    server.use(
      http.get("https://graph.facebook.com/v25.0/debug_token", () =>
        HttpResponse.json(
          { data: { is_valid: true, expires_at: 0, app_id: "APP", user_id: "USR", scopes: [] } },
          { status: 200 }
        )
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const info = await client.healthCheck({ retryPolicy: NO_RETRY });
    expect(info.expiresAt).toBeNull();
  });

  it("throws WhatsAppError when Meta reports is_valid=false with an error message", async () => {
    server.use(
      http.get("https://graph.facebook.com/v25.0/debug_token", () =>
        HttpResponse.json(
          {
            data: {
              is_valid: false,
              error: { code: 190, message: "Invalid OAuth access token." },
            },
          },
          { status: 200 }
        )
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    try {
      await client.healthCheck({ retryPolicy: NO_RETRY });
      throw new Error("did not throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WhatsAppError);
      expect((err as Error).message).toContain("Invalid OAuth access token");
    }
  });

  it("throws WhatsAppError when the body has no `data` field", async () => {
    server.use(
      http.get("https://graph.facebook.com/v25.0/debug_token", () =>
        HttpResponse.json({}, { status: 200 })
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(client.healthCheck({ retryPolicy: NO_RETRY })).rejects.toBeInstanceOf(
      WhatsAppError
    );
  });

  it("propagates non-2xx errors (e.g., 401 invalid token)", async () => {
    server.use(
      http.get("https://graph.facebook.com/v25.0/debug_token", () =>
        HttpResponse.json(
          { error: { code: 190, message: "Invalid OAuth access token" } },
          { status: 401 }
        )
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await expect(client.healthCheck({ retryPolicy: NO_RETRY })).rejects.toBeInstanceOf(
      WhatsAppError
    );
  });
});
