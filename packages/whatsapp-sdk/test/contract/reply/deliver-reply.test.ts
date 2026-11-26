// deliverReply against the real WhatsAppClient + msw. Parity with
// doji-agent test/whatsapp/reply-optout.test.ts (deliverReply), plus
// error propagation the SDK's typed taxonomy makes possible.
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { MockWhatsAppClient } from "../../../src/mock/client.js";
import { deliverReply, isInteractiveFallbackError, replyAsText } from "../../../src/reply/index.js";
import { InMemoryStorage } from "../../../src/storage/index.js";
import {
  AuthenticationError,
  CapabilityError,
  OptOutError,
  RateLimitError,
  WhatsAppError,
  WindowClosedError,
} from "../../../src/types/errors.js";
import { WindowTracker } from "../../../src/window/index.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const NO_RETRY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitter: "full" as const,
  floorMs: 0,
};
const TO = "50688887777";
const URL_ = "https://graph.facebook.com/v26.0/PNID/messages";

interface Sent {
  type: string;
  body: Record<string, unknown>;
}

function client(
  options: Partial<ConstructorParameters<typeof WhatsAppClient>[0]> = {}
): WhatsAppClient {
  return new WhatsAppClient({
    phoneNumberId: "PNID",
    wabaId: "WABA",
    token: "TOKEN",
    appSecret: "SECRET",
    ...options,
  });
}

/** Meta endpoint fake: records sends; `reject` returns a Meta error for interactive sends. */
function meta(reject?: { status: number; code: number }): Sent[] {
  const sent: Sent[] = [];
  let n = 0;
  server.use(
    http.post(URL_, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const type = body.type as string;
      if (reject && type === "interactive") {
        return HttpResponse.json(
          { error: { code: reject.code, message: "(#x) rejected", type: "OAuthException" } },
          { status: reject.status }
        );
      }
      sent.push({ type, body });
      n++;
      return HttpResponse.json({
        messaging_product: "whatsapp",
        contacts: [{ input: TO, wa_id: TO }],
        messages: [{ id: `wamid.${n}` }],
      });
    })
  );
  return sent;
}

/** deliverReply with retries off, so Meta errors surface on the first attempt. */
const deliver: typeof deliverReply = (c, to, reply, options = {}) =>
  deliverReply(c, to, reply, { requestOptions: { retryPolicy: NO_RETRY }, ...options });

const textOf = (s: Sent): string => (s.body.text as { body: string }).body;

describe("deliverReply — text", () => {
  it("text over 4,096 goes out as several messages, nothing dropped", async () => {
    const sent = meta();
    const body = `${"a".repeat(4000)}\n\n${"b".repeat(4000)}\n\n${"c".repeat(100)}`;
    const r = await deliver(client(), TO, { kind: "text", body });
    expect(r).toEqual({ kind: "text", messages: 3, messageIds: ["wamid.1", "wamid.2", "wamid.3"] });
    expect(sent.map(textOf).join("\n\n")).toBe(body);
    expect(sent.every((s) => s.type === "text")).toBe(true);
  });

  it("quotes replyTo on the first part only and auto-enables link previews", async () => {
    const sent = meta();
    const body = `${"a".repeat(4090)}\n\nhttps://x.test`;
    await deliver(client(), TO, { kind: "text", body }, { replyTo: "wamid.in" });
    expect(sent[0]!.body.context).toEqual({ message_id: "wamid.in" });
    expect(sent[1]!.body.context).toBeUndefined();
    expect((sent[0]!.body.text as { preview_url?: boolean }).preview_url).toBeUndefined();
    expect((sent[1]!.body.text as { preview_url?: boolean }).preview_url).toBe(true);
  });
});

describe("deliverReply — interactive", () => {
  it("buttons, list and cta_url go out as interactive messages", async () => {
    const sent = meta();
    const c = client();
    await deliver(c, TO, {
      kind: "buttons",
      body: "¿Sí?",
      buttons: [{ id: "y", title: "Sí" }],
    });
    await deliver(c, TO, {
      kind: "list",
      body: "Elegí",
      button: "Ver",
      rows: [{ id: "a", title: "A" }],
    });
    await deliver(c, TO, {
      kind: "cta_url",
      body: "Abrí",
      cta: { label: "Abrir", url: "https://x.test" },
    });
    expect(sent.map((s) => (s.body.interactive as { type: string }).type)).toEqual([
      "button",
      "list",
      "cta_url",
    ]);
  });

  it("a prompt longer than the interactive body is sent whole as text, then the buttons with the continuation body", async () => {
    const sent = meta();
    const body = "p".repeat(1500);
    const r = await deliver(
      client(),
      TO,
      { kind: "buttons", body, buttons: [{ id: "a", title: "Aprobar" }] },
      { continuationBody: "¿Qué hacemos?" }
    );
    expect(r).toEqual({ kind: "buttons", messages: 2, messageIds: ["wamid.1", "wamid.2"] });
    expect(sent[0]!.type).toBe("text");
    expect(textOf(sent[0]!)).toBe(body);
    expect(sent[1]!.type).toBe("interactive");
    expect((sent[1]!.body.interactive as { body: { text: string } }).body.text).toBe(
      "¿Qué hacemos?"
    );
  });

  it("uses a neutral default continuation body (no consumer copy)", async () => {
    const sent = meta();
    await deliver(client(), TO, {
      kind: "cta_url",
      body: "p".repeat(1500),
      cta: { label: "Abrir", url: "https://x.test" },
    });
    expect((sent[1]!.body.interactive as { body: { text: string } }).body.text).toBe("…");
  });

  it("falls back to numbered plain text when Meta refuses the interactive message", async () => {
    const sent = meta({ status: 400, code: 100 });
    const reply = {
      kind: "buttons" as const,
      body: "¿Aprobás?",
      buttons: [
        { id: "a", title: "Aprobar" },
        { id: "d", title: "Rechazar" },
      ],
    };
    const r = await deliver(client(), TO, reply);
    expect(r).toEqual({ kind: "text", messages: 1, fallback: true, messageIds: ["wamid.1"] });
    expect(sent).toHaveLength(1);
    expect(textOf(sent[0]!)).toBe(replyAsText(reply));
    expect(textOf(sent[0]!)).toBe("¿Aprobás?\n1. Aprobar\n2. Rechazar");
  });

  it("long body + rejection: the prompt as text, then the choices as text under the continuation body", async () => {
    const sent = meta({ status: 400, code: 131009 });
    const r = await deliver(
      client(),
      TO,
      {
        kind: "list",
        body: "q".repeat(5000),
        button: "Ver",
        rows: [{ title: "A" }, { title: "B" }],
      },
      { continuationBody: "Opciones:" }
    );
    expect(r).toMatchObject({ kind: "text", fallback: true, messages: 3 });
    expect(sent.map(textOf).slice(0, 2).join("")).toBe("q".repeat(5000));
    expect(textOf(sent[2]!)).toBe("Opciones:\n1. A\n2. B");
  });

  it("an interactive the strict builder refuses (nothing usable left) falls back to text", async () => {
    const sent = meta();
    const r = await deliver(client(), TO, {
      kind: "cta_url",
      body: "Abrí",
      cta: { label: "Abrir", url: "not a url" },
    });
    expect(r).toMatchObject({ kind: "text", fallback: true });
    expect(textOf(sent[0]!)).toBe("Abrí\nnot a url");
  });
});

describe("deliverReply — errors that must propagate", () => {
  it("WindowClosedError (Meta 131047) propagates; no text fallback", async () => {
    const sent = meta({ status: 400, code: 131047 });
    await expect(
      deliver(client(), TO, { kind: "buttons", body: "x", buttons: [{ title: "A" }] })
    ).rejects.toBeInstanceOf(WindowClosedError);
    expect(sent).toHaveLength(0);
  });

  it("WindowClosedError from the client's window tracker propagates before any HTTP", async () => {
    const sent = meta();
    const c = client({
      windowTracker: new WindowTracker({ phoneNumberId: "PNID", storage: new InMemoryStorage() }),
    });
    await expect(deliver(c, TO, { kind: "text", body: "hola" })).rejects.toBeInstanceOf(
      WindowClosedError
    );
    await expect(
      deliver(c, TO, { kind: "buttons", body: "p".repeat(2000), buttons: [{ title: "A" }] })
    ).rejects.toBeInstanceOf(WindowClosedError);
    expect(sent).toHaveLength(0);
  });

  it.each([
    { code: 131050, cls: OptOutError },
    { code: 190, cls: AuthenticationError },
    { code: 131056, cls: RateLimitError },
  ])("Meta $code propagates as $cls.name", async ({ code, cls }) => {
    const sent = meta({ status: 400, code });
    await expect(
      deliver(client(), TO, { kind: "buttons", body: "x", buttons: [{ title: "A" }] })
    ).rejects.toBeInstanceOf(cls);
    expect(sent).toHaveLength(0);
  });

  it("isInteractiveFallbackError: payload rejections yes, window / opt-out / auth / rate limit / non-SDK errors no", () => {
    expect(isInteractiveFallbackError(new CapabilityError("bad"))).toBe(true);
    expect(isInteractiveFallbackError(new WhatsAppError("UNKNOWN", "bad"))).toBe(true);
    expect(isInteractiveFallbackError(new WindowClosedError("x"))).toBe(false);
    expect(isInteractiveFallbackError(new OptOutError("x", "MARKETING"))).toBe(false);
    expect(isInteractiveFallbackError(new AuthenticationError("x"))).toBe(false);
    expect(isInteractiveFallbackError(new RateLimitError("x"))).toBe(false);
    expect(isInteractiveFallbackError(new Error("boom"))).toBe(false);
  });
});

describe("deliverReply — mock parity", () => {
  it("MockWhatsAppClient satisfies ReplyClient and records the same sends", async () => {
    const mock = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    const r = await deliver(mock, TO, {
      kind: "buttons",
      body: "p".repeat(1500),
      buttons: [{ id: "a", title: "A" }],
    });
    expect(r.kind).toBe("buttons");
    expect(r.messages).toBe(2);
    expect(mock.sentMessages.map((m) => m.payload.type)).toEqual(["text", "interactive"]);
  });
});
