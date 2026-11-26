// Pure 24-hour-window decision for agent outbound. Ported from
// doji-agent `src/whatsapp/reply.ts` (outboundMode).

import { WINDOW_TTL_MS } from "../types/constants.js";

/**
 * Safety margin subtracted from the 24-hour window: a send that
 * starts at 23:59 may land after the window closes.
 */
export const WINDOW_MARGIN_MS = 5 * 60 * 1000;

/**
 * How a message may go out right now:
 * - `session`  — inside the window (minus the margin): any message.
 * - `template` — outside it: only an approved template, and only to
 *   someone who has not opted out, when a template is available.
 * - `drop`     — outside the window and no template may be sent.
 */
export type OutboundMode = "session" | "template" | "drop";

export interface OutboundModeInput {
  /** Current time (epoch ms or `Date`). */
  now: number | Date;
  /** The person's last inbound message (epoch ms or `Date`), or `null` if never. */
  lastInboundAt: number | Date | null | undefined;
  /** Opted out of business-initiated messages. Does not block a session reply. */
  optedOut: boolean;
  /** An approved template is configured for this send. */
  hasTemplate: boolean;
  /** Override {@link WINDOW_MARGIN_MS}. */
  marginMs?: number;
}

const ms = (t: number | Date): number => (t instanceof Date ? t.getTime() : t);

/**
 * Decide `session` / `template` / `drop` for an outbound agent
 * message. Pure: no clock, no storage — feed it the timestamps your
 * `WindowTracker` (or database) already holds.
 */
export function outboundMode(input: OutboundModeInput): OutboundMode {
  const margin = input.marginMs ?? WINDOW_MARGIN_MS;
  if (
    input.lastInboundAt !== null &&
    input.lastInboundAt !== undefined &&
    ms(input.now) - ms(input.lastInboundAt) < WINDOW_TTL_MS - margin
  ) {
    return "session";
  }
  if (input.optedOut || !input.hasTemplate) return "drop";
  return "template";
}
