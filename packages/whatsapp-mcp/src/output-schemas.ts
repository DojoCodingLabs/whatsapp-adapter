import { z } from "zod";

/**
 * Pinned outbound-send output schema. The same three fields land
 * on every send tool's `structuredContent`. Held stable across
 * tools to dodge the MCP SDK issue #654 silent-swallow when
 * structuredContent / outputSchema drift apart.
 */
export const SendResultSchema = z.object({
  messageId: z
    .string()
    .describe(
      "Meta-issued message identifier (wamid). Use this to reply / react to this exact message."
    ),
  recipientPhone: z.string().describe("E.164 recipient phone the message was addressed to."),
  wabaPhoneNumberId: z.string().describe("WABA phone-number-id this server is bound to."),
});
export type SendResult = z.infer<typeof SendResultSchema>;

/** Output schema for `whatsapp_get_template`. */
export const TemplateDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string(),
  category: z.string(),
  status: z.string(),
  components: z.array(z.record(z.unknown())),
});

/** Output schema for `whatsapp_list_templates`. */
export const ListTemplatesResultSchema = z.object({
  data: z.array(TemplateDefinitionSchema),
  nextCursor: z.string().optional(),
  prevCursor: z.string().optional(),
});
