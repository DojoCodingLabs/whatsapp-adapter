/**
 * Bridges between the per-tool `{ definition, handler }` exports
 * (used by both `WhatsAppMcpServer` and `createWhatsAppToolset`)
 * and the MCP SDK's stateful `server.registerTool` / `registerResource` /
 * `registerPrompt` API.
 *
 * The point: each tool file owns ONE place where the metadata
 * (`name`, `title`, `description`, `inputSchema`, ...) lives.
 * Both consumption paths read from the same definition, so a
 * rename in one place cannot drift from the other.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { CallToolResult, ToolDefinition } from "./types.js";

/**
 * Adapt a flat `{ definition, handler }` pair into an
 * `McpServer.registerTool(...)` call. The handler receives the
 * MCP-SDK-validated args directly.
 */
export function registerToolOnServer<TArgs>(
  server: McpServer,
  definition: ToolDefinition,
  handler: (args: TArgs) => Promise<CallToolResult>
): void {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      ...(definition.outputSchema !== undefined ? { outputSchema: definition.outputSchema } : {}),
      ...(definition.annotations !== undefined ? { annotations: definition.annotations } : {}),
    },
    handler as never // McpServer's handler type is derived from the input shape; we erase here.
  );
}
