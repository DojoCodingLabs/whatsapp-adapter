import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_VIDEO_TOOL = "whatsapp_send_video" as const;

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  link: z
    .string()
    .url()
    .optional()
    .describe("Public HTTPS URL Meta can fetch. Provide exactly one of `link` or `id`."),
  id: z
    .string()
    .optional()
    .describe("Pre-uploaded Meta media id. Provide exactly one of `link` or `id`."),
  caption: z.string().max(1024).optional(),
  replyTo: z.string().optional(),
};

export function registerSendVideo(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    SEND_VIDEO_TOOL,
    {
      title: "Send WhatsApp video",
      description:
        "Send a video (mp4 / 3gp). Provide either `link` (public URL) or `id` (pre-uploaded media id). Window-gated.",
      inputSchema,
      outputSchema: SendResultSchema.shape,
    },
    async ({ to, link, id, caption, replyTo }) =>
      withErrorMapping(async () => {
        if (!link && !id) {
          return {
            content: [{ type: "text", text: "Provide either `link` (public URL) or `id`." }],
            isError: true as const,
          };
        }
        const response = await ctx.client.sendVideo({
          to,
          ...(link !== undefined ? { link } : {}),
          ...(id !== undefined ? { id } : {}),
          ...(caption !== undefined ? { caption } : {}),
          ...(replyTo !== undefined ? { replyTo } : {}),
        });
        const messageId = extractMessageId(response);
        return {
          content: [{ type: "text", text: `Sent video ${messageId} to ${to}.` }],
          structuredContent: {
            messageId,
            recipientPhone: to,
            wabaPhoneNumberId: ctx.wabaPhoneNumberId,
          },
        };
      })
  );
}
