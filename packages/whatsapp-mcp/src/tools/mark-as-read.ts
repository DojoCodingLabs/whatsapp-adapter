import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { registerToolOnServer } from "../register.js";
import type { CallToolResult, ToolDefinition } from "../types.js";

import type { ServerContext } from "./context.js";

export const MARK_AS_READ_TOOL = "whatsapp_mark_as_read" as const;

const inputSchema = {
  messageId: z
    .string()
    .min(1)
    .describe(
      "Inbound message wamid to acknowledge. You'll have received this on the `message` webhook event."
    ),
  typing: z
    .boolean()
    .optional()
    .describe(
      "When true, also display a typing indicator to the recipient. The indicator auto-dismisses when you send a reply or after ~25 seconds. Use this BEFORE generating a slow response so the customer sees activity instead of silence."
    ),
};

export const MarkAsReadResultSchema = z.object({
  success: z.boolean().describe("Meta's documented response field — `true` on accepted ack."),
  messageId: z.string().describe("Inbound wamid that was acknowledged."),
  typing: z
    .boolean()
    .describe("Whether the call also requested a typing indicator (mirrors the input)."),
});

export const markAsReadDefinition: ToolDefinition = {
  name: MARK_AS_READ_TOOL,
  title: "Mark inbound WhatsApp message as read",
  description:
    "Acknowledge an inbound message (and optionally show a typing indicator). Use this immediately on receiving an inbound webhook so the customer sees the blue double-tick AND, when paired with `typing: true`, a 'typing…' state while you generate a reply. Window-independent — works regardless of the 24-hour window state.",
  inputSchema,
  outputSchema: MarkAsReadResultSchema.shape,
  annotations: {
    idempotentHint: true,
  },
};

export type MarkAsReadArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function handleMarkAsRead(
  ctx: ServerContext,
  { messageId, typing }: MarkAsReadArgs
): Promise<CallToolResult> {
  return await withErrorMapping(async () => {
    const response = await ctx.client.markAsRead({
      messageId,
      ...(typing !== undefined ? { typing } : {}),
    });
    const usedTyping = typing === true;
    return {
      content: [
        {
          type: "text",
          text: usedTyping
            ? `Acked ${messageId} (read) and started typing indicator.`
            : `Acked ${messageId} (read).`,
        },
      ],
      structuredContent: {
        success: response.success,
        messageId,
        typing: usedTyping,
      },
    };
  });
}

export function registerMarkAsRead(server: McpServer, ctx: ServerContext): void {
  registerToolOnServer<MarkAsReadArgs>(server, markAsReadDefinition, (args) =>
    handleMarkAsRead(ctx, args)
  );
}
