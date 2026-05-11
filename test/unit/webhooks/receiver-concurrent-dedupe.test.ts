import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { InMemoryStorage } from "../../../src/storage/index.js";
import { WebhookReceiver } from "../../../src/webhooks/receiver.js";
import { computeSignature } from "../../../src/webhooks/signature.js";

const APP_SECRET = "race-secret";
const VERIFY_TOKEN = "ok";
const FIXTURES = fileURLToPath(new URL("../../__fixtures__/webhooks/", import.meta.url));

/**
 * Concurrent dedupe race test. Meta retries failed deliveries
 * aggressively; production deployments can see the same wamid land
 * twice within the same event-loop tick (e.g. two PoP edges
 * forwarding through the same NLB). The receiver MUST dispatch the
 * handler exactly once even when N parallel handlePayload calls
 * race against each other.
 */

describe("WebhookReceiver: concurrent dedupe race", () => {
  it("100 parallel handlePayload calls with the same wamid invoke the handler exactly once", async () => {
    const receiver = new WebhookReceiver({
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
      storage: new InMemoryStorage(),
    });
    const handler = vi.fn();
    receiver.on("message", handler);

    const raw = await readFile(`${FIXTURES}text-inbound.json`);
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    const sig = "sha256=" + (await computeSignature(raw, APP_SECRET));

    const N = 100;
    const results = await Promise.all(
      Array.from({ length: N }, () => receiver.handlePayload(raw, sig, parsed))
    );

    // All N HTTP-layer responses should be 200 (signatures are valid;
    // the dedupe runs INSIDE the dispatch, not at the ack boundary).
    for (const r of results) {
      expect(r.status).toBe(200);
    }

    // Now wait for every dispatchPromise to settle.
    await Promise.all(results.flatMap((r) => (r.status === 200 ? [r.dispatchPromise] : [])));

    // The handler must have been invoked exactly once across all 100
    // parallel calls. If the dedupe contract is broken under race
    // conditions, this count goes > 1.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("100 parallel handlePayload calls with DIFFERENT wamids each invoke the handler once per id", async () => {
    const receiver = new WebhookReceiver({
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
      storage: new InMemoryStorage(),
    });
    const handler = vi.fn();
    receiver.on("message", handler);

    const baseRaw = await readFile(`${FIXTURES}text-inbound.json`);
    const baseParsed = JSON.parse(baseRaw.toString("utf8")) as Record<string, unknown>;

    const N = 100;
    const variants: Array<{
      raw: Buffer;
      parsed: unknown;
      sig: string;
    }> = [];
    for (let i = 0; i < N; i++) {
      // Vary the wamid in each payload by mutating value.messages[0].id.
      // Easiest deterministic way: re-serialize with the per-iteration id.
      const cloned = JSON.parse(JSON.stringify(baseParsed)) as {
        entry: Array<{ changes: Array<{ value: { messages: Array<{ id: string }> } }> }>;
      };
      cloned.entry[0]!.changes[0]!.value.messages[0]!.id = `wamid.parallel-${i}`;
      const raw = Buffer.from(JSON.stringify(cloned), "utf8");
      const sig = "sha256=" + (await computeSignature(raw, APP_SECRET));
      variants.push({ raw, parsed: cloned, sig });
    }

    const results = await Promise.all(
      variants.map((v) => receiver.handlePayload(v.raw, v.sig, v.parsed))
    );
    await Promise.all(results.flatMap((r) => (r.status === 200 ? [r.dispatchPromise] : [])));

    expect(handler).toHaveBeenCalledTimes(N);
  });
});
