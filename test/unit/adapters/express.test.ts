import { describe, expect, it } from "vitest";

import { createWhatsAppMiddleware } from "../../../src/adapters/express/index.js";

describe("@dojocoding/whatsapp/express stub (Phase 0)", () => {
  it("createWhatsAppMiddleware throws with the documented Phase 8 message", () => {
    expect(() => createWhatsAppMiddleware()).toThrow(/Phase 8/);
  });

  it("throws a plain Error (not a WhatsAppError) so consumers are not lured into typed handling", () => {
    try {
      createWhatsAppMiddleware();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as { code?: string }).code).toBeUndefined();
    }
  });
});
