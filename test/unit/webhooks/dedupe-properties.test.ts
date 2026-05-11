import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { InMemoryStorage } from "../../../src/storage/index.js";
import { WebhookDeduper } from "../../../src/webhooks/dedupe.js";

/**
 * Property tests for the dedupe key contract at the public-API
 * boundary of WebhookDeduper. The dedupe-key derivation itself
 * (`makeDedupeKey` in receiver.ts) is private; this exercises the
 * end-to-end contract instead: distinct keys are independent,
 * repeated keys are dedupe-equal.
 */

describe("WebhookDeduper: property-based", () => {
  it("first sighting returns true; second of the same key returns false — 100 random keys", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 128 }), async (key) => {
        const dedup = new WebhookDeduper(new InMemoryStorage());
        const first = await dedup.markIfNew(key);
        const second = await dedup.markIfNew(key);
        return first === true && second === false;
      }),
      { numRuns: 100 }
    );
  });

  it("distinct keys are independent — both fresh on first sighting", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        async (a, b) => {
          // Skip the degenerate case where the strings collide.
          fc.pre(a !== b);
          const dedup = new WebhookDeduper(new InMemoryStorage());
          const firstA = await dedup.markIfNew(a);
          const firstB = await dedup.markIfNew(b);
          return firstA === true && firstB === true;
        }
      ),
      { numRuns: 50 }
    );
  });

  it("Unicode keys (emoji, non-ASCII) preserve identity correctly", async () => {
    const keys = ["msg:📱+5210000000001", "status:wamid.x:read", "📨:" + "x".repeat(50)];
    const dedup = new WebhookDeduper(new InMemoryStorage());
    for (const k of keys) {
      expect(await dedup.markIfNew(k)).toBe(true);
    }
    for (const k of keys) {
      expect(await dedup.markIfNew(k)).toBe(false);
    }
  });
});
