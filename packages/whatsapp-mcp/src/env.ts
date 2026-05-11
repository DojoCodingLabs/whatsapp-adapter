/**
 * Credential + config loader for the bin entry. Reads
 * environment variables first and falls back to long-form
 * CLI flags. Hard-fails on missing required fields with a
 * stderr-friendly message naming the env var the operator
 * needs to set.
 *
 * Tool handlers SHALL NOT receive credentials as arguments —
 * spec requirement, enforced because the model could echo a
 * token back in `content[].text` and leak it.
 */

export interface McpServerConfig {
  /** Phone number id this server speaks for (one WABA-phone pair per process). */
  phoneNumberId: string;
  /** WhatsApp Business Account id — required for template registry reads. */
  wabaId: string;
  /** BISU / System User token used for outbound Graph API calls. */
  accessToken: string;
  /** App secret (reserved for future inbound webhook surface; not used by v1 tools). */
  appSecret: string;
  /** Optional Graph API version pin; falls through to the SDK's default. */
  graphApiVersion?: string;
  /** stderr log level (default `info`). */
  logLevel: "debug" | "info" | "warn" | "error";
  /**
   * Backend selection. `"real"` (default) uses the live
   * `WhatsAppClient` against Meta's Graph API. `"mock"` swaps in
   * `MockWhatsAppClient` via the SDK's `pickWhatsAppClient` factory —
   * no network calls, deterministic `wamid.mock-N` returns. The
   * mock-mode banner appears on stderr at startup so operators can
   * confirm the mode they booted into.
   */
  mode: "real" | "mock";
}

const REQUIRED_ENV_VARS = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"] as const;

const CLI_FLAG_TO_FIELD: Record<string, keyof McpServerConfig> = {
  "--access-token": "accessToken",
  "--phone-number-id": "phoneNumberId",
  "--business-account-id": "wabaId",
  "--api-version": "graphApiVersion",
  "--app-secret": "appSecret",
  "--log-level": "logLevel",
  "--mode": "mode",
};

const VALID_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const VALID_MODES = new Set(["real", "mock"]);

export class McpConfigError extends Error {
  public readonly missing: ReadonlyArray<string>;

  constructor(missing: ReadonlyArray<string>) {
    const fields = missing.join(", ");
    super(
      `Missing required configuration: ${fields}. Set the equivalent environment variable(s) or pass the matching --flag on the command line. Required: ${REQUIRED_ENV_VARS.join(", ")}.`
    );
    this.name = "McpConfigError";
    this.missing = missing;
  }
}

interface RawConfig {
  accessToken?: string;
  phoneNumberId?: string;
  wabaId?: string;
  appSecret?: string;
  graphApiVersion?: string;
  logLevel?: string;
  mode?: string;
}

function readEnv(env: NodeJS.ProcessEnv): RawConfig {
  const out: RawConfig = {};
  const map: Record<string, keyof RawConfig> = {
    WHATSAPP_ACCESS_TOKEN: "accessToken",
    WHATSAPP_PHONE_NUMBER_ID: "phoneNumberId",
    WHATSAPP_BUSINESS_ACCOUNT_ID: "wabaId",
    WHATSAPP_APP_SECRET: "appSecret",
    WHATSAPP_API_VERSION: "graphApiVersion",
    WHATSAPP_MODE: "mode",
    MCP_LOG_LEVEL: "logLevel",
  };
  for (const [envName, field] of Object.entries(map)) {
    const v = env[envName];
    if (v !== undefined) out[field] = v;
  }
  return out;
}

function readArgv(argv: ReadonlyArray<string>): RawConfig {
  const out: RawConfig = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token || !token.startsWith("--")) continue;
    let flag = token;
    let value: string | undefined;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      flag = token.slice(0, eq);
      value = token.slice(eq + 1);
    } else {
      value = argv[++i];
    }
    const field = CLI_FLAG_TO_FIELD[flag];
    if (!field || value === undefined) continue;
    (out as Record<string, string>)[field] = value;
  }
  return out;
}

function normaliseLogLevel(raw: string | undefined): McpServerConfig["logLevel"] {
  if (!raw) return "info";
  return VALID_LOG_LEVELS.has(raw) ? (raw as McpServerConfig["logLevel"]) : "info";
}

function normaliseMode(
  raw: string | undefined,
  warn: (msg: string) => void
): McpServerConfig["mode"] {
  if (!raw) return "real";
  if (VALID_MODES.has(raw)) return raw as McpServerConfig["mode"];
  warn(`WHATSAPP_MODE="${raw}" not recognised; falling back to "real". Valid values: real, mock.`);
  return "real";
}

export interface LoadConfigInput {
  env?: NodeJS.ProcessEnv;
  argv?: ReadonlyArray<string>;
  /**
   * Optional warning sink for non-fatal config issues (e.g. an
   * unrecognised `WHATSAPP_MODE` value). Defaults to writing one
   * line to `process.stderr`. Tests pass a capturing sink so
   * warnings can be asserted.
   */
  warn?: (msg: string) => void;
}

/**
 * Resolve config from env + CLI flags. CLI flags take precedence
 * (matches the Stripe MCP pattern). Throws `McpConfigError`
 * naming every missing required field at once, so the operator
 * fixes them in one pass.
 */
export function loadConfigFromEnv(input: LoadConfigInput = {}): McpServerConfig {
  const env = input.env ?? process.env;
  const argv = input.argv ?? process.argv.slice(2);
  const warn = input.warn ?? ((msg: string) => process.stderr.write(`${msg}\n`));

  const fromEnv = readEnv(env);
  const fromArgv = readArgv(argv);

  const merged: RawConfig = { ...fromEnv, ...fromArgv };

  const missing: string[] = [];
  if (!merged.accessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (!merged.phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");

  if (missing.length > 0) throw new McpConfigError(missing);

  return {
    accessToken: merged.accessToken as string,
    phoneNumberId: merged.phoneNumberId as string,
    wabaId: merged.wabaId ?? "",
    appSecret: merged.appSecret ?? "",
    ...(merged.graphApiVersion !== undefined ? { graphApiVersion: merged.graphApiVersion } : {}),
    logLevel: normaliseLogLevel(merged.logLevel),
    mode: normaliseMode(merged.mode, warn),
  };
}
