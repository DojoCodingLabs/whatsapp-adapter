// Text helpers for agent replies: code-point-safe splitting and
// clipping, and Markdown → WhatsApp formatting. Ported from
// doji-agent `src/whatsapp/graph.ts` + `reply.ts` (exact semantics).

import { MESSAGE_LENGTH_LIMITS } from "../types/constants.js";

/** Separators tried, in order, when looking for a natural break. */
const BREAKS = ["\n\n", "\n", ". ", " "] as const;

/**
 * Split `text` into WhatsApp-sized messages of at most `max` Unicode
 * code points each, never dropping a character.
 *
 * Inside each `max`-sized window the split prefers a paragraph break,
 * then a line break, then a sentence end (`". "`), then a space — but
 * only when that break falls in the last half of the window. Only a
 * single unbroken run longer than `max` is cut mid-word. Whitespace
 * at the cut is trimmed from both sides (it is the break itself);
 * the input is trimmed once up front. Emoji and other astral
 * characters are never split in half.
 *
 * Returns `[]` for an empty / whitespace-only input.
 */
export function splitText(text: string, max: number = MESSAGE_LENGTH_LIMITS.textBody): string[] {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError("splitText: `max` must be a positive integer.");
  }
  const out: string[] = [];
  let rest = Array.from(text.trim());
  const floor = Math.floor(max * 0.5);
  while (rest.length > max) {
    const window = rest.slice(0, max).join("");
    let cut = -1;
    for (const sep of BREAKS) {
      const at = window.lastIndexOf(sep);
      if (at >= floor) {
        cut = Array.from(window.slice(0, at + sep.length)).length;
        break;
      }
    }
    if (cut <= 0) cut = max;
    const head = rest.slice(0, cut).join("").trimEnd();
    if (head) out.push(head);
    rest = Array.from(rest.slice(cut).join("").trimStart());
  }
  const tail = rest.join("");
  if (tail) out.push(tail);
  return out;
}

/**
 * Trim `text` and clip it to at most `max` Unicode code points,
 * ending with `…` when it had to be shortened. For interactive
 * fields (button titles, row titles, labels) — message bodies are
 * split with {@link splitText} instead, never clipped.
 */
export function clipText(text: string | null | undefined, max: number): string {
  const chars = Array.from((text ?? "").trim());
  if (chars.length <= max) return chars.join("");
  if (max <= 1) return chars.slice(0, Math.max(0, max)).join("");
  return (
    chars
      .slice(0, max - 1)
      .join("")
      .trimEnd() + "…"
  );
}

/**
 * Convert the Markdown an LLM tends to write into WhatsApp's
 * formatting: `# Heading` → `*Heading*`, `**b**` → `*b*`,
 * `__i__` → `_i_`, `~~s~~` → `~s~`, and `[text](https://url)` →
 * `text: https://url` (just the URL when text and URL are equal).
 */
export function toWhatsAppText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/~~(.+?)~~/g, "~$1~")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t: string, u: string) =>
      t === u ? u : `${t}: ${u}`
    );
}
