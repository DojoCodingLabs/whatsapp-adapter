import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { MockWhatsAppClient } from "../../../src/mock/client.js";
import { pickWhatsAppClient } from "../../../src/mock/factory.js";

const ORIG = process.env["WHATSAPP_MODE"];

beforeEach(() => {
  delete process.env["WHATSAPP_MODE"];
});

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env["WHATSAPP_MODE"];
  } else {
    process.env["WHATSAPP_MODE"] = ORIG;
  }
});

const REAL_OPTIONS = {
  phoneNumberId: "PNID",
  wabaId: "WABA",
  token: "TOKEN",
  appSecret: "APP-SECRET",
} as const;

describe("pickWhatsAppClient", () => {
  it("returns WhatsAppClient when WHATSAPP_MODE is unset", () => {
    expect(pickWhatsAppClient({ ...REAL_OPTIONS })).toBeInstanceOf(WhatsAppClient);
  });

  it("returns MockWhatsAppClient when WHATSAPP_MODE=mock", () => {
    process.env["WHATSAPP_MODE"] = "mock";
    expect(pickWhatsAppClient({ ...REAL_OPTIONS })).toBeInstanceOf(MockWhatsAppClient);
  });

  it("forceMock overrides env (env unset → mock)", () => {
    expect(pickWhatsAppClient({ ...REAL_OPTIONS, forceMock: true })).toBeInstanceOf(
      MockWhatsAppClient
    );
  });

  it("forceReal overrides env (env=mock → real)", () => {
    process.env["WHATSAPP_MODE"] = "mock";
    expect(pickWhatsAppClient({ ...REAL_OPTIONS, forceReal: true })).toBeInstanceOf(WhatsAppClient);
  });

  it("WHATSAPP_MODE=real (or anything other than 'mock') returns real", () => {
    process.env["WHATSAPP_MODE"] = "real";
    expect(pickWhatsAppClient({ ...REAL_OPTIONS })).toBeInstanceOf(WhatsAppClient);
  });
});
