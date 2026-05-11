import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_DOCUMENT_TOOL = "whatsapp_send_document" as const;

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  link: z
    .string()
    .url()
    .optional()
    .describe("Public HTTPS URL Meta can fetch (pdf / docx / etc.). Exactly one of `link`/`id`."),
  id: z.string().optional().describe("Pre-uploaded Meta media id. Exactly one of `link`/`id`."),
  filename: z
    .string()
    .optional()
    .describe(
      "Filename shown to the recipient (with extension, e.g. `invoice.pdf`). Optional but strongly recommended for documents."
    ),
  caption: z.string().max(1024).optional(),
  replyTo: z.string().optional(),
};

export function registerSendDocument(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    SEND_DOCUMENT_TOOL,
    {
      title: "Send WhatsApp document",
      description:
        "Send a document (pdf, docx, xlsx, etc.) via public URL or pre-uploaded media id. Window-gated.",
      inputSchema,
      outputSchema: SendResultSchema.shape,
    },
    async ({ to, link, id, filename, caption, replyTo }) =>
      withErrorMapping(async () => {
        if (!link && !id) {
          return {
            content: [{ type: "text", text: "Provide either `link` (public URL) or `id`." }],
            isError: true as const,
          };
        }
        const response = await ctx.client.sendDocument({
          to,
          ...(link !== undefined ? { link } : {}),
          ...(id !== undefined ? { id } : {}),
          ...(filename !== undefined ? { filename } : {}),
          ...(caption !== undefined ? { caption } : {}),
          ...(replyTo !== undefined ? { replyTo } : {}),
        });
        const messageId = extractMessageId(response);
        return {
          content: [{ type: "text", text: `Sent document ${messageId} to ${to}.` }],
          structuredContent: {
            messageId,
            recipientPhone: to,
            wabaPhoneNumberId: ctx.wabaPhoneNumberId,
          },
        };
      })
  );
}
