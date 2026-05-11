import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_AUTH_TEMPLATE_TOOL = "whatsapp_send_auth_template" as const;

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  name: z.string().min(1).describe("Approved authentication-template name."),
  language: z.string().min(2).describe("Template language code (BCP-47)."),
  otp: z
    .string()
    .min(1)
    .max(15)
    .describe(
      "One-time password / verification code. Capped at 15 chars by Meta. The builder duplicates it into both the body and the URL-button parameters automatically."
    ),
  otpButtonIndex: z
    .string()
    .optional()
    .describe(
      "Index of the URL button on the approved template. Defaults to `0` (matches Meta's documented example)."
    ),
  replyTo: z.string().optional(),
};

export function registerSendAuthTemplate(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    SEND_AUTH_TEMPLATE_TOOL,
    {
      title: "Send WhatsApp authentication (OTP) template",
      description:
        "Send an approved authentication template (copy-code / one-tap / zero-tap OTP). **Window-exempt.** The builder handles the OTP-duplication footgun (Meta requires the code in both the body and URL-button parameters).",
      inputSchema,
      outputSchema: SendResultSchema.shape,
    },
    async ({ to, name, language, otp, otpButtonIndex, replyTo }) =>
      withErrorMapping(async () => {
        const response = await ctx.client.sendAuthTemplate({
          to,
          name,
          language,
          otp,
          ...(otpButtonIndex !== undefined ? { otpButtonIndex } : {}),
          ...(replyTo !== undefined ? { replyTo } : {}),
        });
        const messageId = extractMessageId(response);
        return {
          content: [
            {
              type: "text",
              text: `Sent auth template ${name} (${language}) as ${messageId} to ${to}.`,
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
