import { TemplateError } from "../types/errors.js";

/**
 * Matches both positional (`{{1}}`) and named (`{{customer_name}}`)
 * placeholders. Meta allows letters, digits and underscores in
 * parameter names.
 */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const NUMERIC_RE = /^\d+$/;

/** Every raw placeholder token in `text`, de-duplicated, in order of first appearance. */
export function listTemplatePlaceholders(text: string | undefined): ReadonlyArray<string> {
  if (typeof text !== "string" || text.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  let match: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(text)) !== null) {
    const raw = match[1] ?? "";
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

/** `true` when `text` contains at least one non-numeric (`{{name}}`) placeholder. */
export function hasNamedTemplatePlaceholders(text: string | undefined): boolean {
  return listTemplatePlaceholders(text).some((token) => !NUMERIC_RE.test(token));
}

/**
 * Count the number of unique `{{N}}` placeholders in a positional template
 * body / header string. Validates that placeholders are 1-INDEXED and
 * contiguous (no gaps).
 *
 * Throws `TemplateError` on:
 * - any `{{0}}` (Meta's variables are 1-indexed)
 * - gaps (e.g., `{{1}}` and `{{3}}` without a `{{2}}`)
 * - a named placeholder (`{{customer_name}}`) — use
 *   {@link extractNamedTemplatePlaceholders} for `parameter_format: "NAMED"`
 *   templates.
 *
 * Repeated indices are counted once.
 */
export function countTemplatePlaceholders(text: string | undefined): number {
  const tokens = listTemplatePlaceholders(text);
  if (tokens.length === 0) return 0;
  const indices = new Set<number>();
  for (const raw of tokens) {
    if (!NUMERIC_RE.test(raw)) {
      throw new TemplateError(
        `Template placeholder "{{${raw}}}" is named; this template uses parameter_format "NAMED" and every parameter needs a \`parameter_name\`.`
      );
    }
    const idx = Number.parseInt(raw, 10);
    if (idx === 0) {
      throw new TemplateError("Template placeholders are 1-indexed; `{{0}}` is invalid.");
    }
    indices.add(idx);
  }
  const max = Math.max(...indices);
  for (let i = 1; i <= max; i += 1) {
    if (!indices.has(i)) {
      throw new TemplateError(
        `Template placeholders must be contiguous; missing \`{{${i}}}\` between {{1}} and {{${max}}}.`
      );
    }
  }
  return max;
}

/**
 * Unique placeholder names in a `parameter_format: "NAMED"` template
 * string, in order of first appearance. Throws `TemplateError` when a
 * positional `{{N}}` token is mixed in — Meta rejects mixed templates.
 */
export function extractNamedTemplatePlaceholders(text: string | undefined): ReadonlyArray<string> {
  const tokens = listTemplatePlaceholders(text);
  for (const raw of tokens) {
    if (NUMERIC_RE.test(raw)) {
      throw new TemplateError(
        `Named template mixes a positional placeholder "{{${raw}}}" with named ones; Meta does not allow mixing.`
      );
    }
  }
  return tokens;
}
