import { describe, expect, it } from "vitest";

import { InMemoryStorage } from "../../../src/storage/index.js";

import { storageContractTests } from "./contract.js";

storageContractTests("InMemoryStorage", ({ now }) => new InMemoryStorage({ now }));

describe("InMemoryStorage internals", () => {
  it("expired entries are pruned on access (no leaked timers)", async () => {
    let t = 0;
    const s = new InMemoryStorage({ now: () => t });
    await s.set("k", "v", 100);
    expect(s._rawSize()).toBe(1);
    t = 101;
    await s.get<string>("k");
    expect(s._rawSize()).toBe(0);
  });
});
