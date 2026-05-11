import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_AUDIO_TOOL = "whatsapp_send_audio" as const;

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  link: z
    .string()
    .url()
    .optional()
    .describe("Public HTTPS URL Meta can fetch (mp3 / ogg / aac). Exactly one of `link`/`id`."),
  id: z.string().optional().describe("Pre-uploaded Meta media id. Exactly one of `link`/`id`."),
  replyTo: z.string().optional(),
};

export function registerSendAudio(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    SEND_AUDIO_TOOL,
    {
      title: "Send WhatsApp audio",
      description:
        "Send an audio file (not a voice note — see `whatsapp_send_voice` for those). Window-gated.",
      inputSchema,
      outputSchema: SendResultSchema.shape,
    },
    async ({ to, link, id, replyTo }) =>
      withErrorMapping(async () => {
        if (!link && !id) {
          return {
            content: [{ type: "text", text: "Provide either `link` (public URL) or `id`." }],
            isError: true as const,
          };
        }
        const response = await ctx.client.sendAudio({
          to,
          ...(link !== undefined ? { link } : {}),
          ...(id !== undefined ? { id } : {}),
          ...(replyTo !== undefined ? { replyTo } : {}),
        });
        const messageId = extractMessageId(response);
        return {
          content: [{ type: "text", text: `Sent audio ${messageId} to ${to}.` }],
          structuredContent: {
            messageId,
            recipientPhone: to,
            wabaPhoneNumberId: ctx.wabaPhoneNumberId,
          },
        };
      })
  );
}
