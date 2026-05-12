import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";
import { registerToolOnServer } from "../register.js";
import type { CallToolResult, ToolDefinition } from "../types.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_IMAGE_TOOL = "whatsapp_send_image" as const;

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  link: z
    .string()
    .url()
    .optional()
    .describe(
      "Public HTTPS URL Meta can fetch (jpeg / png). Provide exactly one of `link` or `id`."
    ),
  id: z
    .string()
    .optional()
    .describe(
      "Pre-uploaded Meta media id. Provide exactly one of `link` or `id`. Use the SDK's `uploadMedia` to produce one — agents typically prefer `link`."
    ),
  caption: z.string().max(1024).optional().describe("Optional caption (up to 1024 chars)."),
  replyTo: z.string().optional().describe("Optional wamid to reply to."),
};

export const sendImageDefinition: ToolDefinition = {
  name: SEND_IMAGE_TOOL,
  title: "Send WhatsApp image",
  description: "Send an image (jpeg / png) via public URL or pre-uploaded media id. Window-gated.",
  inputSchema,
  outputSchema: SendResultSchema.shape,
};

export type SendImageArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function handleSendImage(
  ctx: ServerContext,
  { to, link, id, caption, replyTo }: SendImageArgs
): Promise<CallToolResult> {
  return await withErrorMapping(async () => {
    if (!link && !id) {
      return {
        content: [
          {
            type: "text",
            text: "Provide either `link` (public URL) or `id` (pre-uploaded media id).",
          },
        ],
        isError: true as const,
      };
    }
    const response = await ctx.client.sendImage({
      to,
      ...(link !== undefined ? { link } : {}),
      ...(id !== undefined ? { id } : {}),
      ...(caption !== undefined ? { caption } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    const messageId = extractMessageId(response);
    return {
      content: [{ type: "text", text: `Sent image ${messageId} to ${to}.` }],
      structuredContent: {
        messageId,
        recipientPhone: to,
        wabaPhoneNumberId: ctx.wabaPhoneNumberId,
      },
    };
  });
}

export function registerSendImage(server: McpServer, ctx: ServerContext): void {
  registerToolOnServer<SendImageArgs>(server, sendImageDefinition, (args) =>
    handleSendImage(ctx, args)
  );
}
