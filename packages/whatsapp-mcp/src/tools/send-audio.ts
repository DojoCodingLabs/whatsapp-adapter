import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";
import { registerToolOnServer } from "../register.js";
import type { CallToolResult, ToolDefinition } from "../types.js";

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

export const sendAudioDefinition: ToolDefinition = {
  name: SEND_AUDIO_TOOL,
  title: "Send WhatsApp audio",
  description:
    "Send an audio file (not a voice note — see `whatsapp_send_voice` for those). Window-gated.",
  inputSchema,
  outputSchema: SendResultSchema.shape,
};

export type SendAudioArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function handleSendAudio(
  ctx: ServerContext,
  { to, link, id, replyTo }: SendAudioArgs
): Promise<CallToolResult> {
  return await withErrorMapping(async () => {
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
  });
}

export function registerSendAudio(server: McpServer, ctx: ServerContext): void {
  registerToolOnServer<SendAudioArgs>(server, sendAudioDefinition, (args) =>
    handleSendAudio(ctx, args)
  );
}
