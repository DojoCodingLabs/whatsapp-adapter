import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { TemplateDefinitionSchema } from "../output-schemas.js";

import type { ServerContext } from "./context.js";

export const GET_TEMPLATE_TOOL = "whatsapp_get_template" as const;

const inputSchema = {
  templateId: z
    .string()
    .min(1)
    .describe("Template identifier as returned by `whatsapp_list_templates` (the `id` field)."),
};

export function registerGetTemplate(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    GET_TEMPLATE_TOOL,
    {
      title: "Get an approved WhatsApp template",
      description:
        "Fetch a single template by id. Inspect the returned `components` to learn what parameter slots `whatsapp_send_template` needs.",
      inputSchema,
      outputSchema: TemplateDefinitionSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async ({ templateId }) =>
      withErrorMapping(async () => {
        const t = await ctx.client.getTemplate(templateId);
        const structuredContent = {
          id: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          components: t.components.map((c) => ({ ...c })) as Array<Record<string, unknown>>,
        };
        return {
          content: [
            {
              type: "text",
              text: `Template ${t.name} (${t.language}, status=${t.status}, ${t.components.length} component${t.components.length === 1 ? "" : "s"}).`,
            },
          ],
          structuredContent,
        };
      })
  );
}
