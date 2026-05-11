import type { TemplateMessage } from "../messages/types.js";
import { TemplateError } from "../types/errors.js";

import { countTemplatePlaceholders } from "./placeholders.js";
import type { TemplateComponentDefinition, TemplateDefinition } from "./types.js";

/**
 * Cross-validate a built `TemplateMessage` payload against an approved
 * `TemplateDefinition`. Throws `TemplateError(message, definition.name)`
 * on any mismatch:
 *   1. payload.template.name !== definition.name
 *   2. payload.template.language.code !== definition.language
 *   3. for each payload component: matching definition component must
 *      exist (by type, and for buttons also by sub_type/index)
 *   4. parameter count must equal placeholder count in the matching
 *      definition component
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
  const idxRaw = payloadComp.index;
  const idx = typeof idxRaw === "string" ? Number.parseInt(idxRaw, 10) : Number.NaN;
  if (!Number.isFinite(idx) || idx < 0) {
    throw new TemplateError(
      `Button component requires a numeric \`index\` string; received "${String(idxRaw)}".`,
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
