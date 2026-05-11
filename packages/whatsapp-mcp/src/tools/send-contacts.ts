import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_CONTACTS_TOOL = "whatsapp_send_contacts" as const;

const contactSchema = z.object({
  name: z.object({
    formatted_name: z.string().min(1),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    middle_name: z.string().optional(),
    suffix: z.string().optional(),
    prefix: z.string().optional(),
  }),
  phones: z
    .array(
      z.object({
        phone: z.string(),
        type: z.string().optional(),
        wa_id: z.string().optional(),
      })
    )
    .optional(),
  emails: z.array(z.object({ email: z.string(), type: z.string().optional() })).optional(),
  org: z
    .object({
      company: z.string().optional(),
      department: z.string().optional(),
      title: z.string().optional(),
    })
    .optional(),
  birthday: z.string().optional(),
});

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  contacts: z
    .array(contactSchema)
    .min(1)
    .describe("One or more contact cards. Each must include `name.formatted_name`."),
  replyTo: z.string().optional(),
};

export function registerSendContacts(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    SEND_CONTACTS_TOOL,
    {
      title: "Send WhatsApp contact card(s)",
      description: "Send one or more contact cards as a single message. Window-gated.",
      inputSchema,
      outputSchema: SendResultSchema.shape,
    },
    async ({ to, contacts, replyTo }) =>
      withErrorMapping(async () => {
        const response = await ctx.client.sendContacts({
          to,
          contacts: contacts as never,
          ...(replyTo !== undefined ? { replyTo } : {}),
        });
        const messageId = extractMessageId(response);
        return {
          content: [
            {
              type: "text",
              text: `Sent ${contacts.length} contact${contacts.length === 1 ? "" : "s"} as ${messageId} to ${to}.`,
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
