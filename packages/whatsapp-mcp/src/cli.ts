/**
 * `dojo-whatsapp-mcp` — stdio MCP server bin.
 *
 * Spawned by Claude Desktop / Cursor / Cline / any
 * MCP-compatible host via `claude_desktop_config.json`. Reads
 * credentials from env vars (with optional CLI flag overrides),
 * instantiates a single `WhatsAppLikeClient` bound to one
 * WABA-phone pair, and serves the MCP protocol over stdin/stdout.
 *
 * `WHATSAPP_MODE=mock` swaps in `MockWhatsAppClient` via the
 * SDK's `pickWhatsAppClient` factory — no network calls; useful
 * for setup-verification, prompt-engineering iteration, and
 * downstream consumer CI without provisioning a real WABA.
 *
 * Spec requirement: ALL diagnostic output goes to stderr.
 * Writing anything to stdout that isn't a JSON-RPC message
 * corrupts the framing.
 */

import { pickWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfigFromEnv, McpConfigError } from "./env.js";
import { WhatsAppMcpServer } from "./server.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfigFromEnv();
  } catch (e) {
    if (e instanceof McpConfigError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }

  if (config.mode === "mock") {
    process.stderr.write("MOCK MODE — preview only; no Meta calls\n");
  }

  const client = pickWhatsAppClient({
    forceMock: config.mode === "mock",
    phoneNumberId: config.phoneNumberId,
    wabaId: config.wabaId,
    token: config.accessToken,
    appSecret: config.appSecret,
    ...(config.graphApiVersion !== undefined
      ? { graphApiVersion: config.graphApiVersion as never }
      : {}),
  });

  const server = new WhatsAppMcpServer({
    client,
    wabaPhoneNumberId: config.phoneNumberId,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (config.logLevel === "debug" || config.logLevel === "info") {
    process.stderr.write(
      `@dojocoding/whatsapp-mcp listening on stdio (phone=${config.phoneNumberId}, waba=${config.wabaId || "<unset>"}, mode=${config.mode})\n`
    );
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`fatal: ${msg}\n`);
  process.exit(1);
});
