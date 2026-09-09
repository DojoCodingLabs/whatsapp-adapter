// Capability: template-management (Phase 5). List/get template definitions
// and pre-flight cross-validate outgoing template sends.

export { getTemplate, listTemplates } from "./api.js";
export {
  countTemplatePlaceholders,
  extractNamedTemplatePlaceholders,
  hasNamedTemplatePlaceholders,
  listTemplatePlaceholders,
} from "./placeholders.js";
export type {
  ListTemplatesPaging,
  ListTemplatesQuery,
  ListTemplatesResponse,
  TemplateButtonDefinition,
  TemplateCategory,
  TemplateComponentDefinition,
  TemplateComponentDefinitionType,
  TemplateDefinition,
  TemplateMediaHeaderFormat,
  TemplateParameterFormat,
  TemplateStatus,
} from "./types.js";
export { validateTemplateSend } from "./validate.js";
