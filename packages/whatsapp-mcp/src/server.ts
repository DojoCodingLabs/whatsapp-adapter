import type { WhatsAppLikeClient } from "@dojocoding/whatsapp-sdk";
import type { ServerOptions } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { ServerContext } from "./tools/context.js";
import { registerGetTemplate } from "./tools/get-template.js";
import { registerListTemplates } from "./tools/list-templates.js";
import { registerSendImage } from "./tools/send-image.js";
import { registerSendReaction } from "./tools/send-reaction.js";
import { registerSendTemplate } from "./tools/send-template.js";
import { registerSendText } from "./tools/send-text.js";

const SERVER_INSTRUCTIONS = `
This server exposes the outbound surface of @dojocoding/whatsapp-sdk
as Model Context Protocol tools. Every send tool reaches Meta's
Graph API once and returns the resulting wamid.

Window gating: free-form sends (send_text, send_image, ...) require
the 24-hour customer-service window to be open with the recipient.
If it is closed, the tool returns isError=true with a recovery hint
pointing at send_template (which is window-exempt).

This server is bound to one WABA-phone pair via the credentials it
was started with. Multi-WABA deployments run multiple server
processes, one per pair.
`.trim();

export interface BuildServerInput {
  /** SDK client bound to a single WABA-phone pair. */
  client: WhatsAppLikeClient;
  /**
   * Phone-number-id this server speaks for. Surfaced into every
   * send tool's structuredContent so the LLM can disambiguate
   * across multi-server agent runtimes.
   */
  wabaPhoneNumberId: string;
  /** Override the package version reported via the MCP handshake. */
  serverVersion?: string;
  /** Optional MCP-SDK passthrough. */
  mcpOptions?: ServerOptions;
}

/**
 * Build a configured `McpServer` with all v1 tools registered.
 * The returned server is not yet connected to a transport —
 * callers wrap it with `WhatsAppMcpServer` (or call
 * `.connect(transport)` directly).
 */
export function buildServer(input: BuildServerInput): McpServer {
  const server = new McpServer(
    {
      name: "@dojocoding/whatsapp-mcp",
      version: input.serverVersion ?? "0.1.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
      ...(input.mcpOptions ?? {}),
    }
  );

  const ctx: ServerContext = {
    client: input.client,
    wabaPhoneNumberId: input.wabaPhoneNumberId,
  };

  // Send tools
  registerSendText(server, ctx);
  registerSendImage(server, ctx);
  registerSendTemplate(server, ctx);
  registerSendReaction(server, ctx);

  // Read tools
  registerListTemplates(server, ctx);
  registerGetTemplate(server, ctx);

  return server;
}

/**
 * Thin wrapper around `McpServer` that also retains a reference
 * to the bound `WhatsAppClient` and the phone-number-id. Useful
 * for tests and for programmatic embedding inside larger agent
 * runtimes (e.g. a Claude Agent SDK process that hosts the MCP
 * server in-process via `InMemoryTransport`).
 */
export class WhatsAppMcpServer {
  public readonly server: McpServer;
  public readonly client: WhatsAppLikeClient;
  public readonly wabaPhoneNumberId: string;

  constructor(input: BuildServerInput) {
    this.server = buildServer(input);
    this.client = input.client;
    this.wabaPhoneNumberId = input.wabaPhoneNumberId;
  }

  public connect(transport: Transport): Promise<void> {
    return this.server.connect(transport);
  }

  public close(): Promise<void> {
    return this.server.close();
  }
}
