/**
 * Embedded toolset — the flat, callable consumption surface for
 * `@dojocoding/whatsapp-mcp`. Mirrors the stdio `WhatsAppMcpServer`
 * surface (same 16 tools, 2 resources, 1 prompt, same schemas,
 * same error mapping) without instantiating an MCP `Server` or
 * binding to a transport.
 *
 * Use this when you want to merge our tool surface into an outer
 * MCP gateway (Site2Print's `/api/mcp`, the Claude Agent SDK's
 * in-process model, etc.) or when you want to dispatch a tool
 * from non-MCP code (Vitest, queue workers, HITL operator UIs).
 *
 * See `docs/mcp/embedded.md` for the consumer-facing walkthrough
 * and `docs/cookbook/mcp/embedded-toolset.md` for the
 * gateway-integration recipe.
 */

import { randomUUID } from "node:crypto";

import type { WhatsAppLikeClient, WindowTracker } from "@dojocoding/whatsapp-sdk";
import { z } from "zod";

import { renderWaTemplateSend, waTemplateSendDefinition } from "./prompts/wa-template-send.js";
import {
  buildTemplatesResourceReader,
  templatesResourceDefinition,
  TEMPLATES_RESOURCE_URI,
} from "./resources/templates.js";
import { readWindowResource, windowResourceDefinition } from "./resources/window.js";
import type { ServerContext } from "./tools/context.js";
import { getTemplateDefinition, handleGetTemplate } from "./tools/get-template.js";
import { handleListTemplates, listTemplatesDefinition } from "./tools/list-templates.js";
import { handleSendAudio, sendAudioDefinition } from "./tools/send-audio.js";
import { handleSendAuthTemplate, sendAuthTemplateDefinition } from "./tools/send-auth-template.js";
import {
  handleSendCarouselTemplate,
  sendCarouselTemplateDefinition,
} from "./tools/send-carousel-template.js";
import { handleSendContacts, sendContactsDefinition } from "./tools/send-contacts.js";
import { handleSendDocument, sendDocumentDefinition } from "./tools/send-document.js";
import { handleSendImage, sendImageDefinition } from "./tools/send-image.js";
import {
  handleSendInteractiveButtons,
  sendInteractiveButtonsDefinition,
} from "./tools/send-interactive-buttons.js";
import {
  handleSendInteractiveList,
  sendInteractiveListDefinition,
} from "./tools/send-interactive-list.js";
import { handleSendLocation, sendLocationDefinition } from "./tools/send-location.js";
import { handleSendReaction, sendReactionDefinition } from "./tools/send-reaction.js";
import { handleSendTemplate, sendTemplateDefinition } from "./tools/send-template.js";
import { handleSendText, sendTextDefinition } from "./tools/send-text.js";
import { handleSendVideo, sendVideoDefinition } from "./tools/send-video.js";
import { handleSendVoice, sendVoiceDefinition } from "./tools/send-voice.js";
import type {
  CallToolResult,
  DispatchContext,
  GetPromptResult,
  PromptDefinition,
  ReadResourceResult,
  ResourceDefinition,
  ToolDefinition,
} from "./types.js";

/**
 * Per-handler dispatch entry. `definition` carries the
 * `tools/list` metadata; `handler` is invoked with already-
 * validated args matching the definition's `inputSchema`.
 */
interface ToolEntry {
  readonly definition: ToolDefinition;
  readonly handler: (
    ctx: ServerContext,
    args: never,
    dispatchCtx: DispatchContext
  ) => Promise<CallToolResult>;
}

/**
 * The 16 tool entries, in a stable order. Order matters for
 * `WhatsAppToolset.tools` snapshot equality with downstream
 * `tools/list` consumers.
 */
function buildToolEntries(): ToolEntry[] {
  // Each entry's `handler` runtime type matches its definition's
  // inputSchema; the `as never` cast is the standard pattern for
  // existential typing through a uniform table.
  return [
    { definition: sendTextDefinition, handler: handleSendText },
    { definition: sendImageDefinition, handler: handleSendImage },
    { definition: sendVideoDefinition, handler: handleSendVideo },
    { definition: sendAudioDefinition, handler: handleSendAudio },
    { definition: sendVoiceDefinition, handler: handleSendVoice },
    { definition: sendDocumentDefinition, handler: handleSendDocument },
    { definition: sendLocationDefinition, handler: handleSendLocation },
    { definition: sendContactsDefinition, handler: handleSendContacts },
    {
      definition: sendInteractiveButtonsDefinition,
      handler: handleSendInteractiveButtons,
    },
    {
      definition: sendInteractiveListDefinition,
      handler: handleSendInteractiveList,
    },
    { definition: sendTemplateDefinition, handler: handleSendTemplate },
    {
      definition: sendAuthTemplateDefinition,
      handler: handleSendAuthTemplate,
    },
    {
      definition: sendCarouselTemplateDefinition,
      handler: handleSendCarouselTemplate,
    },
    { definition: sendReactionDefinition, handler: handleSendReaction },
    { definition: listTemplatesDefinition, handler: handleListTemplates },
    { definition: getTemplateDefinition, handler: handleGetTemplate },
  ];
}

/**
 * Input for {@link createWhatsAppToolset}.
 */
export interface CreateToolsetInput {
  /** SDK client bound to a single WABA-phone pair. */
  client: WhatsAppLikeClient;
  /**
   * Phone-number-id this toolset speaks for. Stamped into every
   * send tool's `structuredContent` so downstream MCP gateways
   * can disambiguate when serving multiple WABAs.
   */
  wabaPhoneNumberId: string;
  /**
   * Optional 24-h window tracker. When provided, the
   * `whatsapp://window/{phone}` resource reads from it; when
   * absent, the resource returns `isOpen: false` with a notice.
   */
  windowTracker?: WindowTracker;
  /**
   * Clock injection for the templates-resource cache. Test-only.
   */
  now?: () => number;
}

/**
 * The embedded toolset surface. The shape is intentionally MCP-
 * spec-shaped — `tools`/`resources`/`prompts` arrays match the
 * `tools/list` / `resources/list` / `prompts/list` response
 * payloads. Dispatch is by name; arguments are validated against
 * the tool's `inputSchema` before invoking the handler.
 */
export interface WhatsAppToolset {
  readonly tools: ReadonlyArray<ToolDefinition>;
  readonly resources: ReadonlyArray<ResourceDefinition>;
  readonly prompts: ReadonlyArray<PromptDefinition>;
  dispatch(name: string, args: unknown, ctx?: DispatchContext): Promise<CallToolResult>;
  readResource(uri: string): Promise<ReadResourceResult>;
  renderPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult>;
}

const UNKNOWN_TOOL_HINT =
  "The tool name does not match any of the toolset's registered tools. Re-read `tools/list` to find the correct name; tool names are stable across releases under the v1 semver commitment.";

const INVALID_ARGS_HINT =
  "Tool args failed schema validation. Re-read the tool's `inputSchema` and supply the expected fields; field-level errors are in `structuredContent.error.details`.";

const UNKNOWN_RESOURCE_HINT =
  "The resource URI does not match any of the toolset's registered resources. Use `whatsapp://templates` or `whatsapp://window/<phone>`.";

const UNKNOWN_PROMPT_HINT =
  "The prompt name does not match any of the toolset's registered prompts. The only v1 prompt is `wa-template-send`.";

/**
 * Build a flat, callable toolset that exposes the same 16 tools,
 * 2 resources, and 1 prompt as `WhatsAppMcpServer` without
 * binding to a transport.
 *
 * Surface parity with `WhatsAppMcpServer` is enforced by the
 * drift detector at
 * `test/contract/embedded-toolset-parity.test.ts`.
 *
 * @example
 * ```ts
 * import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
 * import { createWhatsAppToolset } from "@dojocoding/whatsapp-mcp";
 *
 * const client = new WhatsAppClient({
 *   phoneNumberId, wabaId, token, appSecret,
 * });
 * const toolset = createWhatsAppToolset({
 *   client,
 *   wabaPhoneNumberId: phoneNumberId,
 * });
 *
 * // In your MCP gateway's tools/list handler:
 * const merged = [...toolset.tools, ...otherUpstreamTools];
 *
 * // In tools/call dispatch:
 * if (name.startsWith("whatsapp_")) {
 *   return toolset.dispatch(name, args);
 * }
 * ```
 */
export function createWhatsAppToolset(input: CreateToolsetInput): WhatsAppToolset {
  const entries = buildToolEntries();
  const tools: ReadonlyArray<ToolDefinition> = entries.map((e) => e.definition);
  const entryByName = new Map(entries.map((e) => [e.definition.name, e]));

  const ctx: ServerContext = {
    client: input.client,
    wabaPhoneNumberId: input.wabaPhoneNumberId,
  };

  const readTemplatesResource = buildTemplatesResourceReader(input.client, input.now);

  const resources: ReadonlyArray<ResourceDefinition> = [
    templatesResourceDefinition,
    windowResourceDefinition,
  ];

  const prompts: ReadonlyArray<PromptDefinition> = [waTemplateSendDefinition];

  async function dispatch(
    name: string,
    args: unknown,
    dispatchCtx: DispatchContext = {}
  ): Promise<CallToolResult> {
    const entry = entryByName.get(name);
    if (!entry) {
      return {
        content: [{ type: "text", text: UNKNOWN_TOOL_HINT }],
        isError: true,
        structuredContent: {
          error: {
            code: "unknown_tool",
            message: `Tool "${name}" is not registered on this toolset.`,
            recoveryHint: UNKNOWN_TOOL_HINT,
          },
        },
      };
    }

    const parsed = z.object(entry.definition.inputSchema).safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: "text", text: INVALID_ARGS_HINT }],
        isError: true,
        structuredContent: {
          error: {
            code: "invalid_args",
            message: `Tool "${name}" args failed schema validation.`,
            recoveryHint: INVALID_ARGS_HINT,
            details: parsed.error.format(),
          },
        },
      };
    }

    const effectiveCtx: DispatchContext = {
      requestId: dispatchCtx.requestId ?? randomUUID(),
      ...(dispatchCtx.abortSignal !== undefined ? { abortSignal: dispatchCtx.abortSignal } : {}),
    };

    return entry.handler(ctx, parsed.data as never, effectiveCtx);
  }

  async function readResource(uri: string): Promise<ReadResourceResult> {
    if (uri === TEMPLATES_RESOURCE_URI) {
      return readTemplatesResource(uri);
    }
    if (uri.startsWith("whatsapp://window/")) {
      return readWindowResource(uri, input.windowTracker);
    }
    // Unrecognised — match the MCP spec's tools/call error shape
    // for consistency. The MCP SDK throws a JSON-RPC error here;
    // we return a typed structured-content error since the
    // toolset has no transport to surface a protocol error to.
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            error: {
              code: "unknown_resource",
              message: `Resource "${uri}" is not registered on this toolset.`,
              recoveryHint: UNKNOWN_RESOURCE_HINT,
            },
          }),
        },
      ],
    };
  }

  function renderPrompt(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<GetPromptResult> {
    if (name !== waTemplateSendDefinition.name) {
      return Promise.resolve({
        messages: [
          {
            role: "user",
            content: { type: "text", text: UNKNOWN_PROMPT_HINT },
          },
        ],
      });
    }
    return Promise.resolve(renderWaTemplateSend(args));
  }

  return {
    tools,
    resources,
    prompts,
    dispatch,
    readResource,
    renderPrompt,
  };
}
