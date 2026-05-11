export { buildServer, WhatsAppMcpServer, type BuildServerInput } from "./server.js";
export {
  loadConfigFromEnv,
  McpConfigError,
  type LoadConfigInput,
  type McpServerConfig,
} from "./env.js";
export { mapSdkError, withErrorMapping, type ToolErrorResponse } from "./errors.js";

// Tool name constants — let consumers reference the canonical
// names without retyping them (drift-resistant).
export { SEND_TEXT_TOOL } from "./tools/send-text.js";
export { SEND_IMAGE_TOOL } from "./tools/send-image.js";
export { SEND_TEMPLATE_TOOL } from "./tools/send-template.js";
export { SEND_REACTION_TOOL } from "./tools/send-reaction.js";
export { LIST_TEMPLATES_TOOL } from "./tools/list-templates.js";
export { GET_TEMPLATE_TOOL } from "./tools/get-template.js";
