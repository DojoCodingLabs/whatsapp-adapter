import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";
import { registerToolOnServer } from "../register.js";
import type { CallToolResult, ToolDefinition } from "../types.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_INTERACTIVE_LIST_TOOL = "whatsapp_send_interactive_list" as const;

const rowSchema = z.object({
  id: z.string().min(1).describe("Stable row id (received back when the user picks)."),
  title: z.string().min(1).describe("Row title (24 chars max per Meta)."),
  description: z.string().optional().describe("Optional row description (72 chars max)."),
});

const sectionSchema = z.object({
  title: z.string().min(1).describe("Section header title."),
  rows: z.array(rowSchema).min(1).max(10),
});

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  body: z.string().min(1),
  button: z.string().min(1).describe('Label for the "View options" button that opens the list.'),
  sections: z.array(sectionSchema).min(1).max(10).describe("1–10 sections, each with 1–10 rows."),
  header: z
    .object({ type: z.literal("text"), text: z.string() })
    .optional()
    .describe("Optional text header (list messages only support text headers)."),
  footer: z.string().optional(),
  replyTo: z.string().optional(),
};

export const sendInteractiveListDefinition: ToolDefinition = {
  name: SEND_INTERACTIVE_LIST_TOOL,
  title: "Send WhatsApp interactive list message",
  description:
    "Send a body + sectioned list of selectable rows. Each row's `id` lands on the inbound webhook when the user picks it. Window-gated.",
  inputSchema,
  outputSchema: SendResultSchema.shape,
};

export type SendInteractiveListArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function handleSendInteractiveList(
  ctx: ServerContext,
  { to, body, button, sections, header, footer, replyTo }: SendInteractiveListArgs
): Promise<CallToolResult> {
  return await withErrorMapping(async () => {
    const response = await ctx.client.sendInteractive({
      kind: "list",
      to,
      body,
      button,
      sections: sections as never,
      ...(header !== undefined ? { header: header as never } : {}),
      ...(footer !== undefined ? { footer } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    const messageId = extractMessageId(response);
    const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
    return {
      content: [
        {
          type: "text",
          text: `Sent interactive list (${sections.length} section(s), ${totalRows} row(s)) as ${messageId} to ${to}.`,
        },
      ],
      structuredContent: {
        messageId,
        recipientPhone: to,
        wabaPhoneNumberId: ctx.wabaPhoneNumberId,
      },
    };
  });
}

export function registerSendInteractiveList(server: McpServer, ctx: ServerContext): void {
  registerToolOnServer<SendInteractiveListArgs>(server, sendInteractiveListDefinition, (args) =>
    handleSendInteractiveList(ctx, args)
  );
}
