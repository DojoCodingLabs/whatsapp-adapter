import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryStorage } from "../../../src/storage/index.js";
import { WINDOW_TTL_MS } from "../../../src/types/constants.js";
import { WindowTracker } from "../../../src/window/tracker.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WindowTracker", () => {
  it("default ttlMs equals WINDOW_TTL_MS", () => {
    const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
    expect(t.ttlMs).toBe(WINDOW_TTL_MS);
  });

  it("constructor accepts a custom ttlMs", () => {
    const t = new WindowTracker({
      phoneNumberId: "P",
      storage: new InMemoryStorage(),
      ttlMs: 60_000,
    });
    expect(t.ttlMs).toBe(60_000);
  });

  it("isWindowOpen is false before any notifyInbound", async () => {
    const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
    expect(await t.isWindowOpen("never-seen")).toBe(false);
  });

  it("notifyInbound opens the 24h window", async () => {
    const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
    await t.notifyInbound("521234567890");
    expect(await t.isWindowOpen("521234567890")).toBe(true);
  });

  it("window remains open at 23h59m59s after notify", async () => {
    const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
    await t.notifyInbound("X");
    vi.advanceTimersByTime(WINDOW_TTL_MS - 1_000);
    expect(await t.isWindowOpen("X")).toBe(true);
  });

  it("window closes at TTL+1 ms", async () => {
    const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
    await t.notifyInbound("X");
    vi.advanceTimersByTime(WINDOW_TTL_MS + 1);
    expect(await t.isWindowOpen("X")).toBe(false);
  });

  it("notifyInbound after TTL expiry refreshes the window", async () => {
    const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
    await t.notifyInbound("X");
    vi.advanceTimersByTime(WINDOW_TTL_MS + 1);
    expect(await t.isWindowOpen("X")).toBe(false);
    await t.notifyInbound("X");
    expect(await t.isWindowOpen("X")).toBe(true);
  });

  it("phoneNumberId scopes keys (cross-phone-number isolation)", async () => {
    const storage = new InMemoryStorage();
    const a = new WindowTracker({ phoneNumberId: "A", storage });
    const b = new WindowTracker({ phoneNumberId: "B", storage });
    await a.notifyInbound("X");
    expect(await a.isWindowOpen("X")).toBe(true);
    expect(await b.isWindowOpen("X")).toBe(false);
  });

  it("clear() removes the entry", async () => {
    const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
    await t.notifyInbound("X");
    expect(await t.isWindowOpen("X")).toBe(true);
    await t.clear("X");
    expect(await t.isWindowOpen("X")).toBe(false);
  });
});
