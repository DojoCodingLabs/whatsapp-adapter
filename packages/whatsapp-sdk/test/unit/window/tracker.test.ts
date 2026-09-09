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

  describe("notifyInbound honours the inbound timestamp (audit F4)", () => {
    it("a late delivery whose message is older than ttlMs leaves the window closed", async () => {
      const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
      await t.notifyInbound("X", Date.now() - 30 * 3_600_000);
      expect(await t.isWindowOpen("X")).toBe(false);
    });

    it("an inbound 20h ago opens a window that closes 4h from now, not 24h", async () => {
      const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
      await t.notifyInbound("X", Date.now() - 20 * 3_600_000);
      expect(await t.isWindowOpen("X")).toBe(true);
      vi.advanceTimersByTime(4 * 3_600_000 - 1);
      expect(await t.isWindowOpen("X")).toBe(true);
      vi.advanceTimersByTime(2);
      expect(await t.isWindowOpen("X")).toBe(false);
    });

    it("an older replayed message never shortens a window opened by a newer one", async () => {
      const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
      await t.notifyInbound("X", Date.now() - 1 * 3_600_000); // fresh: 23h left
      await t.notifyInbound("X", Date.now() - 23 * 3_600_000); // replay: 1h left — ignored
      vi.advanceTimersByTime(2 * 3_600_000);
      expect(await t.isWindowOpen("X")).toBe(true);
    });

    it("exactly ttlMs in the past is already closed (exclusive boundary)", async () => {
      const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
      await t.notifyInbound("X", Date.now() - WINDOW_TTL_MS);
      expect(await t.isWindowOpen("X")).toBe(false);
    });

    it("a future-dated timestamp (clock skew) is clamped to now", async () => {
      const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
      await t.notifyInbound("X", Date.now() + 10 * 3_600_000);
      vi.advanceTimersByTime(WINDOW_TTL_MS + 1);
      expect(await t.isWindowOpen("X")).toBe(false);
    });

    it("a live legacy `true` entry (pre-0.10 value shape) still reads as open", async () => {
      const storage = new InMemoryStorage();
      await storage.set("window:P:X", true, WINDOW_TTL_MS);
      const t = new WindowTracker({ phoneNumberId: "P", storage });
      expect(await t.isWindowOpen("X")).toBe(true);
      // And a fresh notify upgrades it to the timestamp shape.
      await t.notifyInbound("X");
      expect(await storage.get("window:P:X")).toBe(Date.now());
    });
  });

  it("clear() removes the entry", async () => {
    const t = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
    await t.notifyInbound("X");
    expect(await t.isWindowOpen("X")).toBe(true);
    await t.clear("X");
    expect(await t.isWindowOpen("X")).toBe(false);
  });
});
