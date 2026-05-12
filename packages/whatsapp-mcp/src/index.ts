export { buildServer, WhatsAppMcpServer, type BuildServerInput } from "./server.js";
export {
  loadConfigFromEnv,
  McpConfigError,
  type LoadConfigInput,
  type McpServerConfig,
} from "./env.js";
export { mapSdkError, withErrorMapping, type ToolErrorResponse } from "./errors.js";

// Embedded toolset — flat, callable surface mirroring the stdio
// server's 16 tools / 2 resources / 1 prompt. Use this when
// merging Dojo's tool surface into an outer MCP gateway or when
// dispatching tools from non-MCP callsites. See
// docs/mcp/embedded.md for usage.
export { createWhatsAppToolset, type CreateToolsetInput, type WhatsAppToolset } from "./toolset.js";

// Streamable HTTP handler — Fetch-API native MCP transport
// runnable on Vercel / Cloudflare Workers / Hono / Next.js App
// Router / Bun / Deno / Node 18+. Built-in bearer auth (static
// token or verifier callback). See docs/mcp/http.md.
export {
  createWhatsAppHttpHandler,
  type CreateWhatsAppHttpHandlerInput,
  type WhatsAppHttpHandler,
  type AuthInfo,
} from "./http.js";

// Shared MCP-spec-shaped types consumed by both the stdio server
// and the embedded toolset. Re-exported so downstream consumers
// (gateway implementations, tests) can type their dispatch glue
// against the same contract.
export type {
  CallToolResult,
  DispatchContext,
  GetPromptResult,
  PromptDefinition,
  ReadResourceResult,
  ResourceContent,
  ResourceDefinition,
  ToolAnnotations,
  ToolDefinition,
  ZodShape,
} from "./types.js";

// Tool-name constants — let consumers reference the canonical
// names without retyping them (drift-resistant).
export { SEND_TEXT_TOOL } from "./tools/send-text.js";
export { SEND_IMAGE_TOOL } from "./tools/send-image.js";
export { SEND_VIDEO_TOOL } from "./tools/send-video.js";
export { SEND_AUDIO_TOOL } from "./tools/send-audio.js";
export { SEND_VOICE_TOOL } from "./tools/send-voice.js";
export { SEND_DOCUMENT_TOOL } from "./tools/send-document.js";
export { SEND_LOCATION_TOOL } from "./tools/send-location.js";
export { SEND_CONTACTS_TOOL } from "./tools/send-contacts.js";
export { SEND_INTERACTIVE_BUTTONS_TOOL } from "./tools/send-interactive-buttons.js";
export { SEND_INTERACTIVE_LIST_TOOL } from "./tools/send-interactive-list.js";
export { SEND_TEMPLATE_TOOL } from "./tools/send-template.js";
export { SEND_AUTH_TEMPLATE_TOOL } from "./tools/send-auth-template.js";
export { SEND_CAROUSEL_TEMPLATE_TOOL } from "./tools/send-carousel-template.js";
export { SEND_REACTION_TOOL } from "./tools/send-reaction.js";
export { LIST_TEMPLATES_TOOL } from "./tools/list-templates.js";
export { GET_TEMPLATE_TOOL } from "./tools/get-template.js";

// Resource + prompt name constants.
export { WINDOW_RESOURCE_NAME, WINDOW_RESOURCE_URI_TEMPLATE } from "./resources/window.js";
export {
  TEMPLATES_CACHE_TTL_MS,
  TEMPLATES_RESOURCE_NAME,
  TEMPLATES_RESOURCE_URI,
} from "./resources/templates.js";
export { WA_TEMPLATE_SEND_PROMPT } from "./prompts/wa-template-send.js";
