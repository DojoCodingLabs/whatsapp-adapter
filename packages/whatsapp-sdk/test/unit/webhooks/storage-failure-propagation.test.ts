import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { Storage } from "../../../src/storage/index.js";
import { WebhookDeduper } from "../../../src/webhooks/dedupe.js";
import { WebhookReceiver } from "../../../src/webhooks/receiver.js";
import { computeSignature } from "../../../src/webhooks/signature.js";
import { WindowTracker } from "../../../src/window/tracker.js";

const APP_SECRET = "shh";
const VERIFY_TOKEN = "ok";
const FIXTURES = fileURLToPath(new URL("../../__fixtures__/webhooks/", import.meta.url));

/**
 * Storage failure propagation. The Storage interface is async and
 * can reject — Redis dropping the connection, Postgres deadlocking,
 * the dev's InMemoryStorage being asked to do something past its
 * Map's GC limit. The SDK must surface those errors rather than
 * silently swallow them (which would degrade the dedupe / window
 * contract without anyone noticing).
 */

function throwingStorage(method: keyof Storage, err: Error): Storage {
  return {
    get: vi.fn(() => (method === "get" ? Promise.reject(err) : Promise.resolve(undefined))),
    set: vi.fn(() => (method === "set" ? Promise.reject(err) : Promise.resolve())),
    setIfAbsent: vi.fn(() =>
      method === "setIfAbsent" ? Promise.reject(err) : Promise.resolve(true)
    ),
    delete: vi.fn(() => (method === "delete" ? Promise.reject(err) : Promise.resolve())),
  } as Storage;
}

describe("Storage failure propagation: WebhookDeduper", () => {
  it("setIfAbsent rejection surfaces as a rejected markIfNew", async () => {
    const dedup = new WebhookDeduper(throwingStorage("setIfAbsent", new Error("redis down")));
    await expect(dedup.markIfNew("wamid.x")).rejects.toThrow(/redis down/);
  });
});

describe("Storage failure propagation: WindowTracker", () => {
  it("get rejection surfaces as a rejected isWindowOpen", async () => {
    const tracker = new WindowTracker({
      phoneNumberId: "PNID",
      storage: throwingStorage("get", new Error("pg connection lost")),
    });
    await expect(tracker.isWindowOpen("+5210000000001")).rejects.toThrow(/pg connection lost/);
  });

  it("set rejection surfaces as a rejected notifyInbound", async () => {
    const tracker = new WindowTracker({
      phoneNumberId: "PNID",
      storage: throwingStorage("set", new Error("network timeout")),
    });
    await expect(tracker.notifyInbound("+5210000000001")).rejects.toThrow(/network timeout/);
  });
});

describe("Storage failure propagation: WebhookReceiver dispatch", () => {
  it("dispatchPromise rejects when the deduper's storage throws (no silent swallow)", async () => {
    const receiver = new WebhookReceiver({
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
      storage: throwingStorage("setIfAbsent", new Error("storage offline")),
    });
    receiver.on("message", vi.fn());

    const raw = await readFile(`${FIXTURES}text-inbound.json`);
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    const sig = "sha256=" + (await computeSignature(raw, APP_SECRET));

    const result = await receiver.handlePayload(raw, sig, parsed);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      await expect(result.dispatchPromise).rejects.toThrow(/storage offline/);
    }
  });
});
