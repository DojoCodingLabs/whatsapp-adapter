import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_TEXT_TOOL = "whatsapp_send_text" as const;

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format (e.g. +5210000000001)."),
  body: z
    .string()
    .min(1)
    .max(4096)
    .describe("Message body (up to 4096 characters). Plaintext; emoji + line breaks OK."),
  previewUrl: z
    .boolean()
    .optional()
    .describe("If true, Meta renders a link preview when the body contains a URL."),
  replyTo: z
    .string()
    .optional()
    .describe(
      "Optional wamid of a message to reply to (creates a quoted-reply). Only valid when the original wamid came from inbound webhooks within the 24h window."
    ),
};

export function registerSendText(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    SEND_TEXT_TOOL,
    {
      title: "Send WhatsApp text",
      description:
        "Send a plain-text message to a WhatsApp recipient. Window-gated: returns a `WINDOW_CLOSED` tool error if the 24-hour customer-service window is closed for this recipient (use `whatsapp_send_template` to re-engage).",
      inputSchema,
      outputSchema: SendResultSchema.shape,
    },
    async ({ to, body, previewUrl, replyTo }) =>
      withErrorMapping(async () => {
        const response = await ctx.client.sendText({
          to,
          body,
          ...(previewUrl !== undefined ? { previewUrl } : {}),
          ...(replyTo !== undefined ? { replyTo } : {}),
        });
        const messageId = extractMessageId(response);
        const structuredContent = {
          messageId,
          recipientPhone: to,
          wabaPhoneNumberId: ctx.wabaPhoneNumberId,
        };
        return {
          content: [{ type: "text", text: `Sent ${messageId} to ${to}.` }],
          structuredContent,
        };
      })
  );
}
