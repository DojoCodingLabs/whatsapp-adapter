import { TemplateError } from "../types/errors.js";

const PLACEHOLDER_RE = /\{\{\s*(\d+)\s*\}\}/g;

/**
 * Count the number of unique `{{N}}` placeholders in a template body / header
 * string. Validates that placeholders are 1-INDEXED and contiguous (no gaps).
 *
 * Throws `TemplateError` on:
 * - any `{{0}}` (Meta's variables are 1-indexed)
 * - gaps (e.g., `{{1}}` and `{{3}}` without a `{{2}}`)
 *
 * Repeated indices are counted once.
 */
export function countTemplatePlaceholders(text: string | undefined): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  const indices = new Set<number>();
  let match: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(text)) !== null) {
    const raw = match[1] ?? "";
    const idx = Number.parseInt(raw, 10);
    if (!Number.isFinite(idx) || idx < 0) {
      throw new TemplateError(
        `Invalid template placeholder "{{${raw}}}": must be a non-negative integer.`
      );
    }
    if (idx === 0) {
      throw new TemplateError("Template placeholders are 1-indexed; `{{0}}` is invalid.");
    }
    indices.add(idx);
  }
  if (indices.size === 0) return 0;
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
