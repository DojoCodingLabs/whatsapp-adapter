import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";

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

describe("listTemplates / getTemplate", () => {
  it("listTemplates GETs /{wabaId}/message_templates with query params", async () => {
    let captured: URL | null = null;
    server.use(
      http.get("https://graph.facebook.com/v23.0/WABA/message_templates", ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json(
          {
            data: [
              {
                id: "TPL_ID",
                name: "appt_reminder",
                language: "en_US",
                category: "UTILITY",
                status: "APPROVED",
                components: [{ type: "BODY", text: "Hi {{1}}, see you at {{2}}." }],
              },
            ],
            paging: { cursors: { after: "AFTER" } },
          },
          { status: 200 }
        );
      })
    );

    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const out = await client.listTemplates(
      { name: "appt", limit: 25, status: "APPROVED" },
      { retryPolicy: NO_RETRY }
    );

    expect(out.data).toHaveLength(1);
    expect(out.data[0]?.name).toBe("appt_reminder");
    expect(captured).not.toBeNull();
    const params = captured!.searchParams;
    expect(params.get("name")).toBe("appt");
    expect(params.get("limit")).toBe("25");
    expect(params.get("status")).toBe("APPROVED");
  });

  it("listTemplates with no query has no `?` in the URL", async () => {
    let path: string | null = null;
    server.use(
      http.get("https://graph.facebook.com/v23.0/WABA/message_templates", ({ request }) => {
        path = new URL(request.url).search;
        return HttpResponse.json({ data: [] }, { status: 200 });
      })
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    await client.listTemplates(undefined, { retryPolicy: NO_RETRY });
    expect(path).toBe("");
  });

  it("getTemplate GETs /{templateId}", async () => {
    server.use(
      http.get("https://graph.facebook.com/v23.0/TPL_ID", () =>
        HttpResponse.json(
          {
            id: "TPL_ID",
            name: "hello_world",
            language: "en_US",
            category: "UTILITY",
            status: "APPROVED",
            components: [],
          },
          { status: 200 }
        )
      )
    );
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    const def = await client.getTemplate("TPL_ID", { retryPolicy: NO_RETRY });
    expect(def.id).toBe("TPL_ID");
    expect(def.name).toBe("hello_world");
  });

  it("getTemplate rejects empty id", () => {
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    expect(() => client.getTemplate("", { retryPolicy: NO_RETRY })).toThrow(TypeError);
  });
});
