import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_INTERACTIVE_BUTTONS_TOOL = "whatsapp_send_interactive_buttons" as const;

const headerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image"),
    image: z.object({ id: z.string().optional(), link: z.string().url().optional() }),
  }),
  z.object({
    type: z.literal("video"),
    video: z.object({ id: z.string().optional(), link: z.string().url().optional() }),
  }),
  z.object({
    type: z.literal("document"),
    document: z.object({
      id: z.string().optional(),
      link: z.string().url().optional(),
      filename: z.string().optional(),
    }),
  }),
]);

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  body: z.string().min(1).describe("Main message body (rendered above the buttons)."),
  buttons: z
    .array(
      z.object({
        id: z
          .string()
          .min(1)
          .describe("Stable button id (you receive this back as a reply button payload)."),
        title: z.string().min(1).describe("Button label (visible to the user)."),
      })
    )
    .min(1)
    .max(3)
    .describe("1–3 quick-reply buttons."),
  header: headerSchema.optional().describe("Optional header (text or media)."),
  footer: z.string().optional(),
  replyTo: z.string().optional(),
};

export function registerSendInteractiveButtons(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    SEND_INTERACTIVE_BUTTONS_TOOL,
    {
      title: "Send WhatsApp interactive buttons message",
      description:
        "Send a body + up to 3 quick-reply buttons. Each button's `id` lands back on the inbound webhook when the user taps. Window-gated.",
      inputSchema,
      outputSchema: SendResultSchema.shape,
    },
    async ({ to, body, buttons, header, footer, replyTo }) =>
      withErrorMapping(async () => {
        const response = await ctx.client.sendInteractive({
          kind: "button",
          to,
          body,
          buttons,
          ...(header !== undefined ? { header: header as never } : {}),
          ...(footer !== undefined ? { footer } : {}),
          ...(replyTo !== undefined ? { replyTo } : {}),
        });
        const messageId = extractMessageId(response);
        return {
          content: [
            {
              type: "text",
              text: `Sent interactive buttons (${buttons.length} options) as ${messageId} to ${to}.`,
            },
          ],
          structuredContent: {
            messageId,
            recipientPhone: to,
            wabaPhoneNumberId: ctx.wabaPhoneNumberId,
          },
        };
      })
  );
}
