import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryStorage } from "../../../src/storage/index.js";
import { WebhookDeduper } from "../../../src/webhooks/dedupe.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WebhookDeduper", () => {
  it("first sighting of a key is new", async () => {
    const d = new WebhookDeduper(new InMemoryStorage(), 60_000);
    expect(await d.markIfNew("wamid.abc")).toBe(true);
  });

  it("second sighting within TTL is duplicate", async () => {
    const d = new WebhookDeduper(new InMemoryStorage(), 60_000);
    expect(await d.markIfNew("wamid.abc")).toBe(true);
    expect(await d.markIfNew("wamid.abc")).toBe(false);
  });

  it("after TTL expiry, the same key is new again", async () => {
    const d = new WebhookDeduper(new InMemoryStorage(), 100);
    expect(await d.markIfNew("wamid.abc")).toBe(true);
    vi.advanceTimersByTime(101);
    expect(await d.markIfNew("wamid.abc")).toBe(true);
  });

  it("different keys do not collide", async () => {
    const d = new WebhookDeduper(new InMemoryStorage(), 60_000);
    expect(await d.markIfNew("wamid.a")).toBe(true);
    expect(await d.markIfNew("wamid.b")).toBe(true);
    expect(await d.markIfNew("wamid.a")).toBe(false);
    expect(await d.markIfNew("wamid.b")).toBe(false);
  });
});
