import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";
import { registerToolOnServer } from "../register.js";
import type { CallToolResult, ToolDefinition } from "../types.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_REACTION_TOOL = "whatsapp_send_reaction" as const;

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  messageId: z
    .string()
    .min(1)
    .describe("wamid of the inbound message to react to. Get it from a webhook event."),
  emoji: z
    .string()
    .describe(
      "Single emoji to react with. Pass an empty string to remove a previously-set reaction."
    ),
};

export const sendReactionDefinition: ToolDefinition = {
  name: SEND_REACTION_TOOL,
  title: "React to a WhatsApp message",
  description:
    "React to a specific inbound message by wamid. **Window-exempt.** Reactions are idempotent (re-sending the same emoji is a no-op); pass an empty `emoji` to clear an existing reaction.",
  inputSchema,
  outputSchema: SendResultSchema.shape,
  annotations: {
    idempotentHint: true,
  },
};

export type SendReactionArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function handleSendReaction(
  ctx: ServerContext,
  { to, messageId, emoji }: SendReactionArgs
): Promise<CallToolResult> {
  return await withErrorMapping(async () => {
    const response = await ctx.client.sendReaction({ to, messageId, emoji });
    const sentId = extractMessageId(response);
    return {
      content: [
        {
          type: "text",
          text: emoji
            ? `Reacted "${emoji}" to ${messageId} (reaction wamid: ${sentId}).`
            : `Cleared reaction on ${messageId} (wamid: ${sentId}).`,
        },
      ],
      structuredContent: {
        messageId: sentId,
        recipientPhone: to,
        wabaPhoneNumberId: ctx.wabaPhoneNumberId,
      },
    };
  });
}

export function registerSendReaction(server: McpServer, ctx: ServerContext): void {
  registerToolOnServer<SendReactionArgs>(server, sendReactionDefinition, (args) =>
    handleSendReaction(ctx, args)
  );
}
