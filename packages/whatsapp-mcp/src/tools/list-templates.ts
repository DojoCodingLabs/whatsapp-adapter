import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { ListTemplatesResultSchema } from "../output-schemas.js";

import type { ServerContext } from "./context.js";

export const LIST_TEMPLATES_TOOL = "whatsapp_list_templates" as const;

const inputSchema = {
  status: z
    .string()
    .optional()
    .describe("Filter by approval status (e.g. `APPROVED`, `PENDING`, `REJECTED`)."),
  category: z
    .string()
    .optional()
    .describe("Filter by template category (`MARKETING`, `UTILITY`, `AUTHENTICATION`)."),
  language: z.string().optional().describe("Filter by language code (e.g. `en_US`)."),
  name: z.string().optional().describe("Filter by exact template name."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Page size (1–100). Defaults to Meta's server-side default if omitted."),
  after: z.string().optional().describe("Forward cursor — pass `nextCursor` from a previous call."),
  before: z
    .string()
    .optional()
    .describe("Backward cursor — pass `prevCursor` from a previous call."),
};

export function registerListTemplates(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    LIST_TEMPLATES_TOOL,
    {
      title: "List approved WhatsApp templates",
      description:
        "List approved message templates for the bound WABA. Useful for grounding the model before calling `whatsapp_send_template` — pass the result through `whatsapp_get_template` to inspect parameter slots.",
      inputSchema,
      outputSchema: ListTemplatesResultSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      withErrorMapping(async () => {
        const response = await ctx.client.listTemplates(input as never);
        const data = response.data.map((t) => ({
          id: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          components: t.components.map((c) => ({ ...c })),
        }));
        const structuredContent = {
          data,
          ...(response.paging?.cursors?.after !== undefined
            ? { nextCursor: response.paging.cursors.after }
            : {}),
          ...(response.paging?.cursors?.before !== undefined
            ? { prevCursor: response.paging.cursors.before }
            : {}),
        };
        return {
          content: [
            {
              type: "text",
              text: `Returned ${data.length} template${data.length === 1 ? "" : "s"}.`,
            },
          ],
          structuredContent,
        };
      })
  );
}
