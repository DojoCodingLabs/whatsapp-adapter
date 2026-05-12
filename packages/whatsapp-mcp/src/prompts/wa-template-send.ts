import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { GetPromptResult, PromptDefinition } from "../types.js";

export const WA_TEMPLATE_SEND_PROMPT = "wa-template-send" as const;

const argsSchema = {
  templateName: z
    .string()
    .optional()
    .describe("Optional template name. If omitted, the model lists available templates first."),
  recipientPhone: z
    .string()
    .optional()
    .describe("Optional recipient phone in E.164 format. If omitted, the model asks."),
};

export const waTemplateSendDefinition: PromptDefinition = {
  name: WA_TEMPLATE_SEND_PROMPT,
  title: "Send a WhatsApp template (guided)",
  description:
    "Guided walkthrough that picks an approved template, asks for variables, and sends. Use this when the customer is out of the 24-hour window or you need to start a fresh conversation.",
  argsSchema,
};

export type WaTemplateSendArgs = z.infer<z.ZodObject<typeof argsSchema>>;

export function renderWaTemplateSend(args: WaTemplateSendArgs): GetPromptResult {
  const { templateName, recipientPhone } = args;
  const lines: string[] = [
    "Please help me send an approved WhatsApp template via this MCP server's tools. Step by step:",
  ];

  if (!templateName) {
    lines.push(
      "1. Read the `whatsapp://templates` resource to see what templates are approved on this WABA. Present the list and ask me which template to send."
    );
  } else {
    lines.push(`1. The template to send is **${templateName}**.`);
  }

  lines.push(
    "2. Call `whatsapp_get_template` with the chosen template's id to inspect its `components` and learn what variable slots (`{{1}}`, `{{2}}`, …) the body / header / buttons need."
  );

  if (!recipientPhone) {
    lines.push("3. Ask me for the recipient phone in E.164 format (e.g. `+5210000000001`).");
  } else {
    lines.push(`3. The recipient is **${recipientPhone}**.`);
  }

  lines.push(
    "4. Ask me for each variable value the template requires, one at a time. Confirm the final shape before sending.",
    "5. Call `whatsapp_send_template` with the gathered values. Report the returned `messageId` back to me."
  );

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: lines.join("\n\n"),
        },
      },
    ],
  };
}

/**
 * Slash-command-style prompt that walks the LLM through sending
 * an approved template. Surfaces in Claude Desktop's prompt
 * picker as `/wa-template-send`.
 *
 * Both arguments are optional — Claude Desktop sends arg values
 * as strings always — and the emitted user-message instructs the
 * model to (1) list templates if needed, (2) fetch the chosen
 * template's schema, (3) ask the user for variable values, (4)
 * call `whatsapp_send_template`.
 */
export function registerWaTemplateSendPrompt(server: McpServer): void {
  server.registerPrompt(
    WA_TEMPLATE_SEND_PROMPT,
    {
      title: waTemplateSendDefinition.title,
      description: waTemplateSendDefinition.description,
      argsSchema,
    },
    (args) => renderWaTemplateSend(args as WaTemplateSendArgs)
  );
}
