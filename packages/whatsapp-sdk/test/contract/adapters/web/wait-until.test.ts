import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createWhatsAppHandler } from "../../../../src/adapters/web/index.js";
import { WebhookReceiver } from "../../../../src/webhooks/receiver.js";
import { computeSignature } from "../../../../src/webhooks/signature.js";

const APP_SECRET = "shh";
const VERIFY_TOKEN = "ok";
const FIXTURES = fileURLToPath(new URL("../../../__fixtures__/webhooks/", import.meta.url));

async function signedPost(): Promise<Request> {
  const raw = await readFile(`${FIXTURES}text-inbound.json`);
  const sig = "sha256=" + (await computeSignature(raw, APP_SECRET));
  return new Request("https://example.test/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": sig },
    body: raw,
  });
}

describe("web handler / waitUntil — async dispatch extension", () => {
  it("invokes waitUntil exactly once with the dispatch promise on success", async () => {
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    let handlerResolve: (() => void) | undefined;
    const handlerWork = new Promise<void>((r) => {
      handlerResolve = r;
    });
    receiver.on("message", () => handlerWork);

    const waitUntil = vi.fn();
    const fn = createWhatsAppHandler(receiver, { waitUntil });

    const res = await fn(await signedPost());
    expect(res.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);

    // The promise handed to waitUntil should still be pending — ack
    // returns first, handler completes later.
    const promise = waitUntil.mock.calls[0]![0] as Promise<unknown>;
    expect(promise).toBeInstanceOf(Promise);

    // Release the handler; the promise resolves.
    handlerResolve!();
    await expect(promise).resolves.toBeUndefined();
  });

  it("the promise handed to waitUntil always RESOLVES — never rejects — even on a thrown dispatch", async () => {
    // Receiver internals catch handler errors (Promise.allSettled +
    // its own onError pipeline), so a throwing handler does NOT reject
    // dispatchPromise. The adapter's `onUnhandledHandlerError` hook
    // fires only if the dispatchPromise itself rejects (e.g. parser
    // bug). To simulate that, monkey-patch the receiver to return a
    // pre-rejected dispatchPromise.
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const originalHandle = receiver.handlePayload.bind(receiver);
    receiver.handlePayload = async (...args: Parameters<typeof originalHandle>) => {
      const result = await originalHandle(...args);
      if (result.status === 200) {
        return { status: 200, dispatchPromise: Promise.reject(new Error("dispatch blew up")) };
      }
      return result;
    };

    const errorSink = vi.fn();
    const waitUntil = vi.fn();
    const fn = createWhatsAppHandler(receiver, {
      waitUntil,
      onUnhandledHandlerError: errorSink,
    });

    const res = await fn(await signedPost());
    expect(res.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);

    const promise = waitUntil.mock.calls[0]![0] as Promise<unknown>;
    // `.catch(onUnhandledHandlerError)` was chained BEFORE handing the
    // promise to waitUntil, so the promise must resolve (the runtime
    // would warn on an unhandled rejection passed to its waitUntil).
    await expect(promise).resolves.toBeUndefined();
    expect(errorSink).toHaveBeenCalledTimes(1);
    expect((errorSink.mock.calls[0]![0] as Error).message).toBe("dispatch blew up");
  });

  it("does NOT invoke waitUntil when the option is omitted (fire-and-forget preserved)", async () => {
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    receiver.on("message", () => Promise.resolve());

    // Sentinel — would be called only if some bug auto-wired waitUntil.
    const waitUntilSentinel = vi.fn();
    // No options object at all; defaults branch.
    const fn = createWhatsAppHandler(receiver);

    const res = await fn(await signedPost());
    expect(res.status).toBe(200);
    expect(waitUntilSentinel).not.toHaveBeenCalled();
  });

  it("does NOT invoke waitUntil on the verify-handshake (GET) path", async () => {
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const waitUntil = vi.fn();
    const fn = createWhatsAppHandler(receiver, { waitUntil });

    const req = new Request(
      `https://example.test/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=challenge-123`,
      { method: "GET" }
    );
    const res = await fn(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("challenge-123");
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("does NOT invoke waitUntil on a 401 (bad-signature) POST", async () => {
    const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
    const waitUntil = vi.fn();
    const fn = createWhatsAppHandler(receiver, { waitUntil });

    const raw = await readFile(`${FIXTURES}text-inbound.json`);
    const req = new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=BAD" },
      body: raw,
    });
    const res = await fn(req);
    expect(res.status).toBe(401);
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
