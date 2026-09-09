import type { TemplateComponent, TemplateMessage } from "../messages/types.js";
import { TemplateError } from "../types/errors.js";

import {
  countTemplatePlaceholders,
  extractNamedTemplatePlaceholders,
  hasNamedTemplatePlaceholders,
} from "./placeholders.js";
import type { TemplateComponentDefinition, TemplateDefinition } from "./types.js";

const MEDIA_HEADER_FORMATS = new Set(["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"]);

/**
 * Cross-validate a built `TemplateMessage` payload against an approved
 * `TemplateDefinition`. Throws `TemplateError(message, definition.name)`
 * on any mismatch:
 *   1. payload.template.name !== definition.name
 *   2. payload.template.language.code !== definition.language
 *   3. for each payload component: matching definition component must
 *      exist (by type, and for buttons also by sub_type/index)
 *   4. text components: parameter count must equal placeholder count
 *      (positional) or the set of `parameter_name`s must equal the set
 *      of `{{name}}` placeholders (`parameter_format: "NAMED"`)
 *   5. media / location headers (`format: IMAGE|VIDEO|DOCUMENT|LOCATION`):
 *      exactly one parameter whose `type` matches the format
 */
export function validateTemplateSend(
  payload: TemplateMessage,
  definition: TemplateDefinition
): void {
  if (payload.template.name !== definition.name) {
    throw new TemplateError(
      `Template name mismatch: payload="${payload.template.name}" vs definition="${definition.name}".`,
      definition.name
    );
  }
  if (payload.template.language.code !== definition.language) {
    throw new TemplateError(
      `Template language mismatch: payload="${payload.template.language.code}" vs definition="${definition.language}".`,
      definition.name
    );
  }
  for (const payloadComp of payload.template.components ?? []) {
    if (payloadComp.type === "button") {
      validateButtonComponent(payloadComp, definition);
      continue;
    }
    // Carousel and limited_time_offer components have no placeholder
    // text in the template definition, so the
    // count-text-placeholders-vs-parameters check below doesn't apply.
    // Carousel placeholders live PER CARD; see the spec
    // delta in openspec/changes/add-message-types-2026q2 § "Placeholder
    // validation respects per-card carousel scope" for the planned
    // deeper validation. v0 falls through to the existing permissive
    // behaviour for templates whose definition shape isn't in scope
    // here.
    if (payloadComp.type === "carousel" || payloadComp.type === "limited_time_offer") {
      continue;
    }
    const defComp = findDefinitionComponent(definition, payloadComp.type);
    if (defComp === undefined) {
      throw new TemplateError(
        `Template component "${payloadComp.type}" not present in definition "${definition.name}".`,
        definition.name
      );
    }
    if (defComp.type === "HEADER" && isMediaHeader(defComp)) {
      validateMediaHeader(payloadComp, defComp, definition);
      continue;
    }
    if (isNamedTemplate(definition, defComp)) {
      validateNamedTextComponent(payloadComp, defComp, definition);
      continue;
    }
    const expected = countTemplatePlaceholders(defComp.text);
    const actual = payloadComp.parameters?.length ?? 0;
    if (expected !== actual) {
      throw new TemplateError(
        `Template component "${payloadComp.type}" expects ${expected} parameter(s) but payload provided ${actual}.`,
        definition.name
      );
    }
  }
}

function isMediaHeader(defComp: TemplateComponentDefinition): boolean {
  return (
    typeof defComp.format === "string" && MEDIA_HEADER_FORMATS.has(defComp.format.toUpperCase())
  );
}

/**
 * Media / location headers carry no `{{N}}` text; Meta requires exactly
 * one parameter whose `type` is the lower-cased header format
 * (`image`, `video`, `document`, `location`).
 */
function validateMediaHeader(
  payloadComp: TemplateComponent,
  defComp: TemplateComponentDefinition,
  definition: TemplateDefinition
): void {
  const format = (defComp.format ?? "").toUpperCase();
  const expectedType = format.toLowerCase();
  const params = payloadComp.parameters ?? [];
  if (params.length !== 1) {
    throw new TemplateError(
      `Template header has format ${format} and expects exactly 1 ${expectedType} parameter; payload provided ${params.length}.`,
      definition.name
    );
  }
  const actualType = params[0]?.type;
  if (actualType !== expectedType) {
    throw new TemplateError(
      `Template header has format ${format}; expected a parameter of type "${expectedType}" but payload provided "${String(actualType)}".`,
      definition.name
    );
  }
}

/**
 * `parameter_format: "NAMED"` when Meta says so, or — for definitions
 * that predate the field — when the component text contains a
 * non-numeric placeholder.
 */
function isNamedTemplate(
  definition: TemplateDefinition,
  defComp: TemplateComponentDefinition
): boolean {
  if (definition.parameter_format !== undefined) {
    return definition.parameter_format.toUpperCase() === "NAMED";
  }
  return hasNamedTemplatePlaceholders(defComp.text);
}

/**
 * Named templates: every parameter needs a `parameter_name`, and the
 * set of names must equal the set of `{{name}}` placeholders in the
 * definition text. Order is irrelevant — Meta matches by name.
 */
function validateNamedTextComponent(
  payloadComp: TemplateComponent,
  defComp: TemplateComponentDefinition,
  definition: TemplateDefinition
): void {
  const expectedNames = extractNamedTemplatePlaceholders(defComp.text);
  const params = payloadComp.parameters ?? [];
  const providedNames: string[] = [];
  for (const param of params) {
    const name = (param as { parameter_name?: unknown }).parameter_name;
    if (typeof name !== "string" || name.length === 0) {
      throw new TemplateError(
        `Template "${definition.name}" uses named parameters; every "${payloadComp.type}" parameter needs a non-empty \`parameter_name\`.`,
        definition.name
      );
    }
    if (providedNames.includes(name)) {
      throw new TemplateError(
        `Template component "${payloadComp.type}" provides parameter_name "${name}" more than once.`,
        definition.name
      );
    }
    providedNames.push(name);
  }
  const missing = expectedNames.filter((n) => !providedNames.includes(n));
  const unexpected = providedNames.filter((n) => !expectedNames.includes(n));
  if (missing.length > 0 || unexpected.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: ${missing.map((n) => `{{${n}}}`).join(", ")}`);
    if (unexpected.length > 0) parts.push(`unexpected: ${unexpected.join(", ")}`);
    throw new TemplateError(
      `Template component "${payloadComp.type}" named parameters do not match the definition (${parts.join("; ")}).`,
      definition.name
    );
  }
}

function findDefinitionComponent(
  definition: TemplateDefinition,
  payloadType: "header" | "body" | "footer" | "button"
): TemplateComponentDefinition | undefined {
  const wantUpper = payloadType.toUpperCase();
  return definition.components.find((c) => c.type === wantUpper);
}

function validateButtonComponent(
  payloadComp: NonNullable<TemplateMessage["template"]["components"]>[number],
  definition: TemplateDefinition
): void {
  const buttons = definition.components.find((c) => c.type === "BUTTONS");
  if (buttons === undefined) {
    throw new TemplateError(
      `Template payload includes a button component but definition "${definition.name}" has no BUTTONS component.`,
      definition.name
    );
  }
  // `index` is `string | number` on the wire type — Meta documents
  // `"0"` for auth-template buttons and `0` for carousel-card
  // buttons. Accept both; reject anything that isn't a whole number ≥ 0.
  const idxRaw = payloadComp.index;
  const idx =
    typeof idxRaw === "number"
      ? idxRaw
      : typeof idxRaw === "string" && /^\d+$/.test(idxRaw.trim())
        ? Number.parseInt(idxRaw, 10)
        : Number.NaN;
  if (!Number.isInteger(idx) || idx < 0) {
    throw new TemplateError(
      `Button component requires a non-negative integer \`index\` (string or number); received "${String(idxRaw)}".`,
      definition.name
    );
  }
  const button = buttons.buttons?.[idx];
  if (button === undefined) {
    throw new TemplateError(
      `Button component index ${idx} is out of range for definition "${definition.name}".`,
      definition.name
    );
  }
  const subType = (payloadComp.sub_type ?? "").toUpperCase();
  if (subType !== "" && button.type.toUpperCase() !== subTypeToButtonType(subType)) {
    throw new TemplateError(
      `Button component sub_type "${payloadComp.sub_type ?? ""}" does not match definition's "${button.type}".`,
      definition.name
    );
  }
}

function subTypeToButtonType(subType: string): string {
  switch (subType) {
    case "QUICK_REPLY":
      return "QUICK_REPLY";
    case "URL":
      return "URL";
    case "COPY_CODE":
      return "COPY_CODE";
    default:
      return subType;
  }
}
