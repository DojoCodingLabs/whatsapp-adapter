import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";
import { registerToolOnServer } from "../register.js";
import type { CallToolResult, ToolDefinition } from "../types.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_LOCATION_TOOL = "whatsapp_send_location" as const;

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  latitude: z.number().gte(-90).lte(90).describe("Decimal degrees, -90 to 90."),
  longitude: z.number().gte(-180).lte(180).describe("Decimal degrees, -180 to 180."),
  name: z.string().optional().describe("Optional location name (shown above the map pin)."),
  address: z.string().optional().describe("Optional human-readable address."),
  replyTo: z.string().optional(),
};

export const sendLocationDefinition: ToolDefinition = {
  name: SEND_LOCATION_TOOL,
  title: "Send WhatsApp location",
  description: "Share a geographic location (decimal lat/lng). Window-gated.",
  inputSchema,
  outputSchema: SendResultSchema.shape,
};

export type SendLocationArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function handleSendLocation(
  ctx: ServerContext,
  { to, latitude, longitude, name, address, replyTo }: SendLocationArgs
): Promise<CallToolResult> {
  return await withErrorMapping(async () => {
    const response = await ctx.client.sendLocation({
      to,
      latitude,
      longitude,
      ...(name !== undefined ? { name } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    const messageId = extractMessageId(response);
    return {
      content: [{ type: "text", text: `Sent location ${messageId} to ${to}.` }],
      structuredContent: {
        messageId,
        recipientPhone: to,
        wabaPhoneNumberId: ctx.wabaPhoneNumberId,
      },
    };
  });
}

export function registerSendLocation(server: McpServer, ctx: ServerContext): void {
  registerToolOnServer<SendLocationArgs>(server, sendLocationDefinition, (args) =>
    handleSendLocation(ctx, args)
  );
}
