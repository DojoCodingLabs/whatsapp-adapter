import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryStorage } from "../../../src/storage/index.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InMemoryStorage", () => {
  it("get/set/delete round-trip", async () => {
    const s = new InMemoryStorage();
    await s.set("k", 42, 60_000);
    expect(await s.get<number>("k")).toBe(42);
    await s.delete("k");
    expect(await s.get<number>("k")).toBeUndefined();
  });

  it("TTL expires lazily on get", async () => {
    const s = new InMemoryStorage();
    await s.set("k", "v", 100);
    expect(await s.get<string>("k")).toBe("v");
    vi.advanceTimersByTime(101);
    expect(await s.get<string>("k")).toBeUndefined();
  });

  it("delete is idempotent on missing key", async () => {
    const s = new InMemoryStorage();
    await expect(s.delete("nonexistent")).resolves.toBeUndefined();
  });

  it("ttlMs <= 0 stores forever", async () => {
    const s = new InMemoryStorage();
    await s.set("k", "forever", 0);
    vi.advanceTimersByTime(10 * 365 * 24 * 60 * 60 * 1000);
    expect(await s.get<string>("k")).toBe("forever");
  });

  it("set overwrites a previous value and TTL", async () => {
    const s = new InMemoryStorage();
    await s.set("k", "old", 100);
    await s.set("k", "new", 60_000);
    vi.advanceTimersByTime(200);
    expect(await s.get<string>("k")).toBe("new");
  });

  it("expired entries are pruned on access (no leaked timers)", async () => {
    const s = new InMemoryStorage();
    await s.set("k", "v", 100);
    expect(s._rawSize()).toBe(1);
    vi.advanceTimersByTime(101);
    await s.get<string>("k");
    expect(s._rawSize()).toBe(0);
  });

  it("`now` injection lets tests step time without setSystemTime", async () => {
    let now = 0;
    const s = new InMemoryStorage({ now: () => now });
    await s.set("k", "v", 100);
    now = 50;
    expect(await s.get<string>("k")).toBe("v");
    now = 101;
    expect(await s.get<string>("k")).toBeUndefined();
  });
});
