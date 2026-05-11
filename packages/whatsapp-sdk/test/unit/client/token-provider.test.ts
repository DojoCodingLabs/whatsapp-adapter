import { describe, expect, it, vi } from "vitest";

import { WhatsAppClient, type TokenProvider } from "../../../src/client/whatsapp-client.js";
import { AuthenticationError, MissingCredentialsError } from "../../../src/types/errors.js";

const BASE_OPTIONS = {
  phoneNumberId: "PNID",
  wabaId: "WABA",
  appSecret: "APP-SECRET",
};

function fakeFetch(status = 200, body: unknown = { id: "1" }): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe("TokenProvider", () => {
  describe("construction", () => {
    it("accepts a sync callback", () => {
      const client = new WhatsAppClient({ ...BASE_OPTIONS, token: () => "TOK" });
      expect(client).toBeDefined();
    });

    it("accepts an async callback", () => {
      const client = new WhatsAppClient({
        ...BASE_OPTIONS,
        token: () => Promise.resolve("TOK"),
      });
      expect(client).toBeDefined();
    });

    it("rejects token=undefined", () => {
      expect(
        () =>
          new WhatsAppClient({
            ...BASE_OPTIONS,
            token: undefined as unknown as string,
          })
      ).toThrow(MissingCredentialsError);
    });

    it("rejects token=null", () => {
      expect(
        () =>
          new WhatsAppClient({
            ...BASE_OPTIONS,
            token: null as unknown as string,
          })
      ).toThrow(MissingCredentialsError);
    });

    it("rejects token=empty string", () => {
      expect(() => new WhatsAppClient({ ...BASE_OPTIONS, token: "" })).toThrow(
        MissingCredentialsError
      );
    });

    it("rejects token={} (non-string, non-function)", () => {
      expect(
        () =>
          new WhatsAppClient({
            ...BASE_OPTIONS,
            token: {} as unknown as string,
          })
      ).toThrow(MissingCredentialsError);
    });

    it("does NOT invoke a callback during construction", () => {
      const provider = vi.fn(() => "TOK") as unknown as TokenProvider;
      const client = new WhatsAppClient({ ...BASE_OPTIONS, token: provider });
      expect(provider).not.toHaveBeenCalled();
      expect(client).toBeDefined();
    });

    it("accepts a callback that throws — error surfaces at first request, not construction", () => {
      const provider: TokenProvider = () => {
        throw new Error("provider boom");
      };
      expect(() => new WhatsAppClient({ ...BASE_OPTIONS, token: provider })).not.toThrow();
    });
  });

  describe("resolution", () => {
    it("fires the callback on each request (not memoized)", async () => {
      const provider = vi.fn(() => "TOK") as unknown as TokenProvider;
      const client = new WhatsAppClient({ ...BASE_OPTIONS, token: provider });
      const fetchImpl = fakeFetch();
      await client.request("GET", "/me", undefined, { fetchImpl });
      await client.request("GET", "/me", undefined, { fetchImpl });
      await client.request("GET", "/me", undefined, { fetchImpl });
      expect(provider).toHaveBeenCalledTimes(3);
    });

    it("uses the resolved string for the Authorization header", async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ id: "1" }), { status: 200 }))
      ) as unknown as typeof fetch;
      const client = new WhatsAppClient({ ...BASE_OPTIONS, token: () => "ABC" });
      await client.request("GET", "/me", undefined, { fetchImpl });
      const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
      const init = call[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer ABC");
    });

    it("accepts async callbacks and awaits them", async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ id: "1" }), { status: 200 }))
      ) as unknown as typeof fetch;
      const client = new WhatsAppClient({
        ...BASE_OPTIONS,
        token: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return "ASYNC-TOK";
        },
      });
      await client.request("GET", "/me", undefined, { fetchImpl });
      const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
      const init = call[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer ASYNC-TOK");
    });

    it("throws AuthenticationError when the callback throws", async () => {
      const fetchImpl = fakeFetch();
      const client = new WhatsAppClient({
        ...BASE_OPTIONS,
        token: () => {
          throw new Error("provider boom");
        },
      });
      await expect(client.request("GET", "/me", undefined, { fetchImpl })).rejects.toThrow(
        AuthenticationError
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("throws AuthenticationError when the callback returns an empty string", async () => {
      const fetchImpl = fakeFetch();
      const client = new WhatsAppClient({ ...BASE_OPTIONS, token: () => "" });
      await expect(client.request("GET", "/me", undefined, { fetchImpl })).rejects.toThrow(
        AuthenticationError
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("throws AuthenticationError when the callback returns a non-string", async () => {
      const fetchImpl = fakeFetch();
      const client = new WhatsAppClient({
        ...BASE_OPTIONS,
        token: (() => 12345) as unknown as TokenProvider,
      });
      await expect(client.request("GET", "/me", undefined, { fetchImpl })).rejects.toThrow(
        AuthenticationError
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("attaches the underlying error as `cause` when the callback throws", async () => {
      const inner = new Error("inner reason");
      const client = new WhatsAppClient({
        ...BASE_OPTIONS,
        token: () => {
          throw inner;
        },
      });
      try {
        await client._resolveBearerToken();
        expect.fail("expected AuthenticationError");
      } catch (err) {
        expect(err).toBeInstanceOf(AuthenticationError);
        expect((err as AuthenticationError & { cause?: unknown }).cause).toBe(inner);
      }
    });
  });
});
