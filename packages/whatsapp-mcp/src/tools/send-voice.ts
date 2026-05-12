import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";
import { registerToolOnServer } from "../register.js";
import type { CallToolResult, ToolDefinition } from "../types.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_VOICE_TOOL = "whatsapp_send_voice" as const;

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  link: z
    .string()
    .url()
    .optional()
    .describe("Public HTTPS URL Meta can fetch. Exactly one of `link`/`id`."),
  id: z.string().optional().describe("Pre-uploaded Meta media id. Exactly one of `link`/`id`."),
  replyTo: z.string().optional(),
};

export const sendVoiceDefinition: ToolDefinition = {
  name: SEND_VOICE_TOOL,
  title: "Send WhatsApp voice note",
  description:
    "Send a voice note (audio with `voice: true`). Triggers transcription, auto-download, and the 'played' delivery status. Use `whatsapp_send_audio` for non-voice audio. Window-gated.",
  inputSchema,
  outputSchema: SendResultSchema.shape,
};

export type SendVoiceArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function handleSendVoice(
  ctx: ServerContext,
  { to, link, id, replyTo }: SendVoiceArgs
): Promise<CallToolResult> {
  return await withErrorMapping(async () => {
    if (!link && !id) {
      return {
        content: [{ type: "text", text: "Provide either `link` (public URL) or `id`." }],
        isError: true as const,
      };
    }
    const response = await ctx.client.sendVoice({
      to,
      ...(link !== undefined ? { link } : {}),
      ...(id !== undefined ? { id } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    const messageId = extractMessageId(response);
    return {
      content: [{ type: "text", text: `Sent voice note ${messageId} to ${to}.` }],
      structuredContent: {
        messageId,
        recipientPhone: to,
        wabaPhoneNumberId: ctx.wabaPhoneNumberId,
      },
    };
  });
}

export function registerSendVoice(server: McpServer, ctx: ServerContext): void {
  registerToolOnServer<SendVoiceArgs>(server, sendVoiceDefinition, (args) =>
    handleSendVoice(ctx, args)
  );
}
