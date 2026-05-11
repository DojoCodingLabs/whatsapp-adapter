import { describe, expect, it } from "vitest";

import { WhatsAppClient } from "../../../src/client/whatsapp-client.js";
import { GRAPH_API_VERSION } from "../../../src/types/constants.js";
import { MissingCredentialsError } from "../../../src/types/errors.js";

const VALID_OPTIONS = {
  phoneNumberId: "PNID",
  wabaId: "WABA",
  token: "TOKEN-VALUE",
  appSecret: "APP-SECRET-VALUE",
} as const;

describe("WhatsAppClient", () => {
  it("constructs with all four credentials and exposes phoneNumberId/wabaId", () => {
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    expect(client.phoneNumberId).toBe("PNID");
    expect(client.wabaId).toBe("WABA");
  });

  it("defaults graphApiVersion to GRAPH_API_VERSION when omitted", () => {
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    expect(client.graphApiVersion).toBe(GRAPH_API_VERSION);
  });

  it("honors a custom graphApiVersion override", () => {
    const client = new WhatsAppClient({ ...VALID_OPTIONS, graphApiVersion: "v22.0" });
    expect(client.graphApiVersion).toBe("v22.0");
  });

  it("does not perform any network I/O during construction", () => {
    // If the client made an HTTP request, fetch would be invoked. We sanity-
    // check by replacing global fetch with a spy and confirming it is never
    // called.
    const original = globalThis.fetch;
    let calls = 0;
    const spy: typeof fetch = () => {
      calls += 1;
      return Promise.reject(new Error("network access not allowed in constructor"));
    };
    globalThis.fetch = spy;
    try {
      new WhatsAppClient({ ...VALID_OPTIONS });
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });

  it("throws MissingCredentialsError when token is empty", () => {
    expect(() => new WhatsAppClient({ ...VALID_OPTIONS, token: "" })).toThrow(
      MissingCredentialsError
    );
    try {
      new WhatsAppClient({ ...VALID_OPTIONS, token: "" });
    } catch (err) {
      const e = err as MissingCredentialsError;
      expect(e.code).toBe("MISSING_CREDENTIALS");
      expect(e.missingFields).toContain("token");
    }
  });

  it("lists every missing field when several are absent", () => {
    try {
      new WhatsAppClient({ ...VALID_OPTIONS, wabaId: "", appSecret: "" });
      throw new Error("did not throw");
    } catch (err) {
      const e = err as MissingCredentialsError;
      expect(e.missingFields).toEqual(expect.arrayContaining(["wabaId", "appSecret"]));
      expect(e.missingFields).not.toContain("phoneNumberId");
      expect(e.missingFields).not.toContain("token");
    }
  });

  it("error message and JSON do NOT include the value of any provided credential", () => {
    try {
      new WhatsAppClient({
        ...VALID_OPTIONS,
        wabaId: "",
        token: "TOKEN-WITH-DISTINCTIVE-VALUE",
        appSecret: "APP-SECRET-WITH-DISTINCTIVE-VALUE",
      });
      throw new Error("did not throw");
    } catch (err) {
      const e = err as MissingCredentialsError;
      expect(e.message).not.toContain("TOKEN-WITH-DISTINCTIVE-VALUE");
      expect(e.message).not.toContain("APP-SECRET-WITH-DISTINCTIVE-VALUE");
      const json = JSON.stringify(e);
      expect(json).not.toContain("TOKEN-WITH-DISTINCTIVE-VALUE");
      expect(json).not.toContain("APP-SECRET-WITH-DISTINCTIVE-VALUE");
    }
  });

  it("treats missing fields and empty strings identically", () => {
    expect(
      () =>
        new WhatsAppClient({
          phoneNumberId: "",
          wabaId: "WABA",
          token: "TOKEN",
          appSecret: "APP-SECRET",
        })
    ).toThrow(MissingCredentialsError);

    expect(
      () =>
        new WhatsAppClient({
          // phoneNumberId omitted entirely
          wabaId: "WABA",
          token: "TOKEN",
          appSecret: "APP-SECRET",
        } as unknown as ConstructorParameters<typeof WhatsAppClient>[0])
    ).toThrow(MissingCredentialsError);
  });

  it("internal accessors resolve the bearer token and expose the app secret", async () => {
    const client = new WhatsAppClient({ ...VALID_OPTIONS });
    expect(await client._resolveBearerToken()).toBe("TOKEN-VALUE");
    expect(client._getAppSecret()).toBe("APP-SECRET-VALUE");
  });
});
