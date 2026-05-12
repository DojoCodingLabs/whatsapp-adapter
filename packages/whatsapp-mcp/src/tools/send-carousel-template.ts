import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { SendResultSchema } from "../output-schemas.js";
import { registerToolOnServer } from "../register.js";
import type { CallToolResult, ToolDefinition } from "../types.js";

import { extractMessageId, type ServerContext } from "./context.js";

export const SEND_CAROUSEL_TEMPLATE_TOOL = "whatsapp_send_carousel_template" as const;

const carouselHeaderSchema = z.object({
  type: z.enum(["image", "video"]).describe("Header media type."),
  mediaId: z
    .string()
    .optional()
    .describe("Pre-uploaded Meta media id. Exactly one of mediaId / link."),
  link: z
    .string()
    .url()
    .optional()
    .describe("Public HTTPS URL Meta will fetch. Exactly one of mediaId / link."),
});

const carouselButtonSchema = z.discriminatedUnion("subType", [
  z.object({
    subType: z.literal("quick_reply"),
    payload: z.string().describe("Stable payload received back when the user taps."),
  }),
  z.object({
    subType: z.literal("url"),
    text: z.string().describe("URL-suffix text appended to the approved button's base URL."),
  }),
]);

const carouselCardSchema = z.object({
  header: carouselHeaderSchema.describe("Image or video header for this card (required by Meta)."),
  bodyParameters: z.array(z.string()).optional(),
  buttons: z.array(carouselButtonSchema).max(2).optional(),
});

const inputSchema = {
  to: z.string().min(1).describe("Recipient phone in E.164 format."),
  name: z.string().min(1).describe("Approved carousel-template name."),
  language: z.string().min(2),
  bodyParameters: z
    .array(z.string())
    .optional()
    .describe(
      "Top-level body-text variable substitutions for the carousel's leading body component."
    ),
  cards: z
    .array(carouselCardSchema)
    .min(1)
    .max(10)
    .describe("1–10 cards. Each card's `card_index` is computed from array position."),
  replyTo: z.string().optional(),
};

export const sendCarouselTemplateDefinition: ToolDefinition = {
  name: SEND_CAROUSEL_TEMPLATE_TOOL,
  title: "Send WhatsApp carousel template",
  description:
    "Send a media-card carousel template (1–10 cards, each with an image/video header and optional body params + buttons). **Window-exempt.** Use `whatsapp_get_template` first to verify the approved card structure.",
  inputSchema,
  outputSchema: SendResultSchema.shape,
};

export type SendCarouselTemplateArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function handleSendCarouselTemplate(
  ctx: ServerContext,
  { to, name, language, bodyParameters, cards, replyTo }: SendCarouselTemplateArgs
): Promise<CallToolResult> {
  return await withErrorMapping(async () => {
    const response = await ctx.client.sendCarouselTemplate({
      to,
      name,
      language,
      cards: cards as never,
      ...(bodyParameters !== undefined ? { bodyParameters } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    const messageId = extractMessageId(response);
    return {
      content: [
        {
          type: "text",
          text: `Sent carousel template ${name} (${cards.length} card${cards.length === 1 ? "" : "s"}) as ${messageId} to ${to}.`,
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

export function registerSendCarouselTemplate(server: McpServer, ctx: ServerContext): void {
  registerToolOnServer<SendCarouselTemplateArgs>(server, sendCarouselTemplateDefinition, (args) =>
    handleSendCarouselTemplate(ctx, args)
  );
}
