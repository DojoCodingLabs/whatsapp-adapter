import { describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../src/client/whatsapp-client.js";
import { MockWhatsAppClient } from "../../src/mock/client.js";

/**
 * Drift detector for `WhatsAppLikeClient`. The interface is the
 * integration surface that consumer wrappers (the consent-broadcast
 * pattern in docs/cookbook/hybrid/, custom audit/rate-limit shims)
 * implement, and the surface `MockWhatsAppClient` exposes for tests.
 *
 * Two failure modes the type system alone misses:
 *
 *   1. A public method added to `WhatsAppClient` that's NOT added to
 *      `WhatsAppLikeClient`. Consumer wrappers can't intercept it;
 *      the mock doesn't have to implement it; downstream code paths
 *      silently fall back to the real client at runtime even when a
 *      mock was expected.
 *   2. A method on `MockWhatsAppClient` that's NOT on `WhatsAppClient`.
 *      Indicates the mock is doing something the real client can't —
 *      tests pass against the mock but fail in production.
 *
 * The interface itself is erased at runtime, so we compare the two
 * class prototypes directly. New methods on either class force a
 * decision: extend the interface, mark intentional asymmetry, or
 * delete the method.
 */

const INTERNAL_PREFIXES = ["_", "#"];

function publicMethodNames(proto: object): Set<string> {
  return new Set(
    Object.getOwnPropertyNames(proto).filter((name) => {
      if (name === "constructor") return false;
      if (INTERNAL_PREFIXES.some((p) => name.startsWith(p))) return false;
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      // Skip getters / setters / fields; only count callable methods.
      return descriptor !== undefined && typeof descriptor.value === "function";
    })
  );
}

/**
 * Methods deliberately on `WhatsAppClient` but NOT shipped through
 * `WhatsAppLikeClient`. Each entry needs a justification. The
 * detector test allows these names to be present on the class and
 * absent from the mock without failing — but adding to this list
 * requires a real review decision.
 */
const INTENTIONALLY_REAL_CLIENT_ONLY: ReadonlyArray<{ name: string; reason: string }> = [
  // `request` is the raw HTTP transport; consumer wrappers should not
  // intercept arbitrary Graph calls, only the typed send/listTemplates
  // surface. Mocking it would dilute the abstraction.
  { name: "request", reason: "raw HTTP transport; not part of the typed integration surface" },
];

describe("WhatsAppLikeClient interface drift detector", () => {
  it("every public method on WhatsAppClient.prototype is reachable on MockWhatsAppClient", () => {
    const realMethods = publicMethodNames(WhatsAppClient.prototype);
    const mockMethods = publicMethodNames(MockWhatsAppClient.prototype);
    const allowed = new Set(INTENTIONALLY_REAL_CLIENT_ONLY.map((e) => e.name));

    const missingFromMock = [...realMethods].filter(
      (name) => !mockMethods.has(name) && !allowed.has(name)
    );
    expect(
      missingFromMock,
      `WhatsAppClient methods missing from MockWhatsAppClient (add them to the mock, to the WhatsAppLikeClient interface, or to INTENTIONALLY_REAL_CLIENT_ONLY with a written reason): ${missingFromMock.join(", ")}`
    ).toEqual([]);
  });

  it("MockWhatsAppClient adds no methods absent on WhatsAppClient (mock cannot do more than real)", () => {
    const realMethods = publicMethodNames(WhatsAppClient.prototype);
    const mockMethods = publicMethodNames(MockWhatsAppClient.prototype);
    // Mock-only helpers that are deliberately not on the real client.
    const mockOnlyHelpers = new Set([
      "reset", // mock test-fixture helper; clears recorded sends
      "simulateInbound", // mock-only: dispatches synthetic webhook events
    ]);

    const extra = [...mockMethods].filter(
      (name) => !realMethods.has(name) && !mockOnlyHelpers.has(name)
    );
    expect(
      extra,
      `MockWhatsAppClient has methods not on WhatsAppClient (add them to the real client or to the mockOnlyHelpers allow-list above): ${extra.join(", ")}`
    ).toEqual([]);
  });

  it("every entry in INTENTIONALLY_REAL_CLIENT_ONLY actually exists on WhatsAppClient", () => {
    // Guard the allow-list itself: a stale entry (method renamed or
    // removed since the entry was added) would mask future drift.
    const realMethods = publicMethodNames(WhatsAppClient.prototype);
    for (const { name } of INTENTIONALLY_REAL_CLIENT_ONLY) {
      expect(
        realMethods.has(name),
        `Allow-list entry "${name}" no longer exists on WhatsAppClient`
      ).toBe(true);
    }
  });

  it("every WhatsAppLikeClient method (as exposed on the mock) is callable on a real WhatsAppClient instance", () => {
    // Runtime sanity: the methods aren't just `.prototype` placeholders
    // — they're actually defined as functions on a constructed instance.
    // Catches accidental shorthand-property removals during refactors.
    const real = new WhatsAppClient({
      phoneNumberId: "PNID",
      wabaId: "WABA",
      token: "test-token",
      appSecret: "test-secret",
    });
    const mock = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    const mockOnly = new Set(["reset", "simulateInbound"]);

    for (const name of publicMethodNames(MockWhatsAppClient.prototype)) {
      if (mockOnly.has(name)) continue;
      expect(
        typeof (real as unknown as Record<string, unknown>)[name],
        `WhatsAppClient instance missing method "${name}" (it's on the prototype but not the instance)`
      ).toBe("function");
      expect(
        typeof (mock as unknown as Record<string, unknown>)[name],
        `MockWhatsAppClient instance missing method "${name}"`
      ).toBe("function");
    }
  });

  it("healthCheck is implemented on both classes (regression guard for the May 2026 drift)", async () => {
    // Specific anchor: in May 2026 the drift detector caught that
    // healthCheck was on WhatsAppClient but NOT on WhatsAppLikeClient,
    // so MockWhatsAppClient didn't have to implement it. The fix added
    // it to the interface as an optional method + a stub on the mock.
    // This test pins the fix.
    const mock = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
    expect(typeof mock.healthCheck).toBe("function");
    const info = await mock.healthCheck();
    expect(info.valid).toBe(true);
    expect(typeof info.appId === "string" || info.appId === null).toBe(true);
  });
});
