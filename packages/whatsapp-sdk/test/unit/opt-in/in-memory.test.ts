import { describe, expect, it } from "vitest";

import { InMemoryOptInRegistry } from "../../../src/opt-in/in-memory.js";

describe("InMemoryOptInRegistry", () => {
  it("returns true for unknown recipients by default", async () => {
    const reg = new InMemoryOptInRegistry();
    expect(await reg.isOptedIn("+5210000000001")).toBe(true);
  });

  it("optOut then isOptedIn returns false", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001");
    expect(await reg.isOptedIn("+5210000000001")).toBe(false);
  });

  it("category-scoped opt-out only blocks that category", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001", { category: "MARKETING" });
    expect(await reg.isOptedIn("+5210000000001", { category: "MARKETING" })).toBe(false);
    expect(await reg.isOptedIn("+5210000000001", { category: "UTILITY" })).toBe(true);
    expect(await reg.isOptedIn("+5210000000001", { category: "AUTHENTICATION" })).toBe(true);
  });

  it("global opt-out blocks every category", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001");
    expect(await reg.isOptedIn("+5210000000001", { category: "MARKETING" })).toBe(false);
    expect(await reg.isOptedIn("+5210000000001", { category: "UTILITY" })).toBe(false);
    expect(await reg.isOptedIn("+5210000000001", { category: "AUTHENTICATION" })).toBe(false);
    expect(await reg.isOptedIn("+5210000000001")).toBe(false);
  });

  it("optIn after optOut re-consents", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001");
    expect(await reg.isOptedIn("+5210000000001")).toBe(false);
    await reg.optIn("+5210000000001");
    expect(await reg.isOptedIn("+5210000000001")).toBe(true);
  });

  it("category-scoped optIn clears that category's opt-out", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001", { category: "MARKETING" });
    await reg.optOut("+5210000000001", { category: "UTILITY" });
    await reg.optIn("+5210000000001", { category: "MARKETING" });
    expect(await reg.isOptedIn("+5210000000001", { category: "MARKETING" })).toBe(true);
    expect(await reg.isOptedIn("+5210000000001", { category: "UTILITY" })).toBe(false);
  });

  it("global optIn clears all category-scoped opt-outs", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001", { category: "MARKETING" });
    await reg.optOut("+5210000000001", { category: "UTILITY" });
    await reg.optIn("+5210000000001");
    expect(await reg.isOptedIn("+5210000000001", { category: "MARKETING" })).toBe(true);
    expect(await reg.isOptedIn("+5210000000001", { category: "UTILITY" })).toBe(true);
  });

  it("optIn is idempotent", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optIn("+5210000000001");
    await reg.optIn("+5210000000001");
    expect(await reg.isOptedIn("+5210000000001")).toBe(true);
  });

  it("optOut is idempotent", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001");
    await reg.optOut("+5210000000001");
    expect(await reg.isOptedIn("+5210000000001")).toBe(false);
  });

  it("opt-out for one recipient does not affect another", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001");
    expect(await reg.isOptedIn("+5210000000001")).toBe(false);
    expect(await reg.isOptedIn("+5210000000002")).toBe(true);
  });

  it("category-scoped opt-outs do NOT block unscoped queries (soft semantic)", async () => {
    const reg = new InMemoryOptInRegistry();
    await reg.optOut("+5210000000001", { category: "MARKETING" });
    // Unscoped query: "is this recipient overall opted in?" — yes, they only
    // opted out of MARKETING. Other categories remain open.
    expect(await reg.isOptedIn("+5210000000001")).toBe(true);
  });

  it("preserves metadata when supplied", async () => {
    const reg = new InMemoryOptInRegistry();
    // We don't have a public accessor for the stored metadata; this
    // test asserts the API accepts the shape without throwing.
    await expect(
      reg.optIn("+5210000000001", {
        category: "MARKETING",
        source: "web-form",
        timestamp: 1735689600000,
        attributes: { ip: "192.0.2.1", userAgent: "test" },
      })
    ).resolves.toBeUndefined();
    await expect(
      reg.optOut("+5210000000002", {
        category: "MARKETING",
        reason: "STOP keyword received",
        timestamp: 1735689600000,
      })
    ).resolves.toBeUndefined();
  });
});
