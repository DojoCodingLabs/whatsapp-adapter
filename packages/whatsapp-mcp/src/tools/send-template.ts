import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";
import { registerToolOnServer } from "../register.js";
import type { CallToolResult, ToolDefinition } from "../types.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_TEMPLATE_TOOL = "whatsapp_send_template" as const;

const templateParameterSchema = z
  .record(z.unknown())
  .describe(
    "A single template-parameter object as documented by Meta (e.g. { type: 'text', text: 'Hello' })."
  );

const templateComponentSchema = z
  .object({
    type: z
      .string()
      .describe(
        "Component type — one of `header`, `body`, `footer`, `button`, `carousel`, `limited_time_offer`."
      ),
    parameters: z.array(templateParameterSchema).optional(),
    sub_type: z.string().optional(),
    index: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  name: z
    .string()
    .min(1)
    .describe("Approved template name as registered in the WABA's template library."),
  language: z
    .string()
    .min(2)
    .describe(
      "Template language code (BCP-47, e.g. `en_US`, `es_MX`). Must match an approved variant."
    ),
  components: z
    .array(templateComponentSchema)
    .optional()
    .describe(
      "Optional component overrides (header / body / button parameters). Inspect the template via `whatsapp_get_template` to see the required shape."
    ),
  replyTo: z.string().optional().describe("Optional wamid to reply to."),
};

export const sendTemplateDefinition: ToolDefinition = {
  name: SEND_TEMPLATE_TOOL,
  title: "Send WhatsApp template",
  description:
    "Send a pre-approved template message. **Window-exempt** — works even when the 24-hour customer-service window is closed (the canonical way to re-engage a customer). Use `whatsapp_get_template` first to verify the variable count and language code.",
  inputSchema,
  outputSchema: SendResultSchema.shape,
};

export type SendTemplateArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function handleSendTemplate(
  ctx: ServerContext,
  { to, name, language, components, replyTo }: SendTemplateArgs
): Promise<CallToolResult> {
  return await withErrorMapping(async () => {
    const response = await ctx.client.sendTemplate({
      to,
      name,
      language,
      ...(components !== undefined ? { components: components as never } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    const messageId = extractMessageId(response);
    return {
      content: [
        { type: "text", text: `Sent template ${name} (${language}) as ${messageId} to ${to}.` },
      ],
      structuredContent: {
        messageId,
        recipientPhone: to,
        wabaPhoneNumberId: ctx.wabaPhoneNumberId,
      },
    };
  });
}

export function registerSendTemplate(server: McpServer, ctx: ServerContext): void {
  registerToolOnServer<SendTemplateArgs>(server, sendTemplateDefinition, (args) =>
    handleSendTemplate(ctx, args)
  );
}
