import { describe, expect, it } from "vitest";

import { loadConfigFromEnv, McpConfigError } from "../../src/env.js";

describe("loadConfigFromEnv", () => {
  describe("required fields", () => {
    it("throws McpConfigError naming every missing env var", () => {
      expect(() => loadConfigFromEnv({ env: {}, argv: [] })).toThrowError(McpConfigError);
      try {
        loadConfigFromEnv({ env: {}, argv: [] });
      } catch (e) {
        expect(e).toBeInstanceOf(McpConfigError);
        const err = e as McpConfigError;
        expect(err.missing).toEqual(["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]);
        expect(err.message).toContain("WHATSAPP_ACCESS_TOKEN");
        expect(err.message).toContain("WHATSAPP_PHONE_NUMBER_ID");
      }
    });

    it("reports only the actually-missing field when one is set", () => {
      try {
        loadConfigFromEnv({ env: { WHATSAPP_ACCESS_TOKEN: "tok" }, argv: [] });
        expect.fail("expected throw");
      } catch (e) {
        expect((e as McpConfigError).missing).toEqual(["WHATSAPP_PHONE_NUMBER_ID"]);
      }
    });

    it("accepts both required env vars", () => {
      const cfg = loadConfigFromEnv({
        env: { WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "pnid" },
        argv: [],
      });
      expect(cfg.accessToken).toBe("tok");
      expect(cfg.phoneNumberId).toBe("pnid");
    });
  });

  describe("CLI flag fallback", () => {
    it("--access-token + --phone-number-id satisfy required fields", () => {
      const cfg = loadConfigFromEnv({
        env: {},
        argv: ["--access-token", "cli-tok", "--phone-number-id", "cli-pnid"],
      });
      expect(cfg.accessToken).toBe("cli-tok");
      expect(cfg.phoneNumberId).toBe("cli-pnid");
    });

    it("--flag=value form works too", () => {
      const cfg = loadConfigFromEnv({
        env: {},
        argv: ["--access-token=tok", "--phone-number-id=pnid"],
      });
      expect(cfg.accessToken).toBe("tok");
      expect(cfg.phoneNumberId).toBe("pnid");
    });

    it("CLI flag overrides env var when both present", () => {
      const cfg = loadConfigFromEnv({
        env: { WHATSAPP_ACCESS_TOKEN: "env-tok", WHATSAPP_PHONE_NUMBER_ID: "env-pnid" },
        argv: ["--access-token=cli-tok"],
      });
      expect(cfg.accessToken).toBe("cli-tok");
      expect(cfg.phoneNumberId).toBe("env-pnid"); // not overridden
    });

    it("unknown flags are ignored", () => {
      const cfg = loadConfigFromEnv({
        env: { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p" },
        argv: ["--bogus", "x", "--also-bogus=y"],
      });
      expect(cfg.accessToken).toBe("t");
    });
  });

  describe("optional fields", () => {
    it("populates wabaId, graphApiVersion, appSecret when set", () => {
      const cfg = loadConfigFromEnv({
        env: {
          WHATSAPP_ACCESS_TOKEN: "t",
          WHATSAPP_PHONE_NUMBER_ID: "p",
          WHATSAPP_BUSINESS_ACCOUNT_ID: "waba",
          WHATSAPP_API_VERSION: "v25.0",
          WHATSAPP_APP_SECRET: "secret",
        },
        argv: [],
      });
      expect(cfg.wabaId).toBe("waba");
      expect(cfg.graphApiVersion).toBe("v25.0");
      expect(cfg.appSecret).toBe("secret");
    });

    it("defaults wabaId + appSecret to empty string when unset", () => {
      const cfg = loadConfigFromEnv({
        env: { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p" },
        argv: [],
      });
      expect(cfg.wabaId).toBe("");
      expect(cfg.appSecret).toBe("");
    });

    it("omits graphApiVersion entirely when unset (lets the SDK default kick in)", () => {
      const cfg = loadConfigFromEnv({
        env: { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p" },
        argv: [],
      });
      expect(cfg.graphApiVersion).toBeUndefined();
    });
  });

  describe("mode (WHATSAPP_MODE)", () => {
    it("defaults to 'real' when env var unset", () => {
      const cfg = loadConfigFromEnv({
        env: { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p" },
        argv: [],
      });
      expect(cfg.mode).toBe("real");
    });

    it("accepts WHATSAPP_MODE=mock", () => {
      const cfg = loadConfigFromEnv({
        env: {
          WHATSAPP_ACCESS_TOKEN: "t",
          WHATSAPP_PHONE_NUMBER_ID: "p",
          WHATSAPP_MODE: "mock",
        },
        argv: [],
      });
      expect(cfg.mode).toBe("mock");
    });

    it("accepts WHATSAPP_MODE=real (explicit)", () => {
      const cfg = loadConfigFromEnv({
        env: {
          WHATSAPP_ACCESS_TOKEN: "t",
          WHATSAPP_PHONE_NUMBER_ID: "p",
          WHATSAPP_MODE: "real",
        },
        argv: [],
      });
      expect(cfg.mode).toBe("real");
    });

    it("normalises unrecognised values to 'real' and emits a warning", () => {
      const warnings: string[] = [];
      const cfg = loadConfigFromEnv({
        env: {
          WHATSAPP_ACCESS_TOKEN: "t",
          WHATSAPP_PHONE_NUMBER_ID: "p",
          WHATSAPP_MODE: "preview",
        },
        argv: [],
        warn: (m) => warnings.push(m),
      });
      expect(cfg.mode).toBe("real");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/preview/);
      expect(warnings[0]).toMatch(/real, mock/);
    });

    it("--mode=mock CLI flag works", () => {
      const cfg = loadConfigFromEnv({
        env: { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p" },
        argv: ["--mode=mock"],
      });
      expect(cfg.mode).toBe("mock");
    });

    it("CLI flag --mode overrides env var", () => {
      const cfg = loadConfigFromEnv({
        env: {
          WHATSAPP_ACCESS_TOKEN: "t",
          WHATSAPP_PHONE_NUMBER_ID: "p",
          WHATSAPP_MODE: "real",
        },
        argv: ["--mode=mock"],
      });
      expect(cfg.mode).toBe("mock");
    });
  });

  describe("log level", () => {
    it("defaults to info when unset", () => {
      const cfg = loadConfigFromEnv({
        env: { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p" },
        argv: [],
      });
      expect(cfg.logLevel).toBe("info");
    });

    it("accepts debug / info / warn / error", () => {
      for (const lvl of ["debug", "info", "warn", "error"] as const) {
        const cfg = loadConfigFromEnv({
          env: { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p", MCP_LOG_LEVEL: lvl },
          argv: [],
        });
        expect(cfg.logLevel).toBe(lvl);
      }
    });

    it("normalises unknown values to info", () => {
      const cfg = loadConfigFromEnv({
        env: {
          WHATSAPP_ACCESS_TOKEN: "t",
          WHATSAPP_PHONE_NUMBER_ID: "p",
          MCP_LOG_LEVEL: "trace",
        },
        argv: [],
      });
      expect(cfg.logLevel).toBe("info");
    });
  });
});
