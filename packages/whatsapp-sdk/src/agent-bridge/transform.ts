import type { MessageEvent } from "../webhooks/events.js";

import type { AgentTask } from "./types.js";

/**
 * Default `MessageEvent → AgentTask` transform. Extracts the
 * fields the front-desk pattern needs out of the typed event:
 * `text`, `mediaIds`, `buttonReplyId` / `listReplyId`, `location`,
 * `replyToWamid`, `ctwaReferral`. Unsupported / unknown types
 * still produce a task with `type === "unsupported"` and the
 * raw event preserved on `task.raw` — consumers can log /
 * observe / route them.
 *
 * Exported so consumers building their own transform can compose
 * it:
 *
 * ```ts
 * transform: (event) => ({
 *   ...defaultAgentTransform(event),
 *   tenantId: resolveTenant(event),
 * })
 * ```
 *
 * Pure; no I/O.
 */
export function defaultAgentTransform(event: MessageEvent): AgentTask {
  const task: AgentTask = {
    receivedAt: event.timestamp,
    conversationId: event.from,
    from: event.from,
    wamid: event.id,
    type: event.type,
    raw: event,
  };

  if (event.phoneNumberId !== undefined) {
    task.wabaPhoneNumberId = event.phoneNumberId;
  }
  if (event.contextId !== undefined) {
    task.replyToWamid = event.contextId;
  }
  if (event.referral !== undefined) {
    task.ctwaReferral = event.referral;
  }

  switch (event.type) {
    case "text": {
      const text = extractTextBody(event.body);
      if (text !== undefined) task.text = text;
      break;
    }
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker": {
      const id = extractMediaId(event.body, event.type);
      if (id !== undefined) task.mediaIds = [id];
      break;
    }
    case "interactive_button_reply": {
      const id = extractInteractiveReplyId(event.body, "button_reply");
      if (id !== undefined) task.buttonReplyId = id;
      break;
    }
    case "interactive_list_reply": {
      const id = extractInteractiveReplyId(event.body, "list_reply");
      if (id !== undefined) task.listReplyId = id;
      break;
    }
    case "location": {
      const loc = extractLocation(event.body);
      if (loc !== undefined) task.location = loc;
      break;
    }
    default:
      // contacts / button (legacy) / order / reaction / system /
      // unsupported — the raw event is preserved on task.raw;
      // consumers extract specifics themselves when needed.
      break;
  }

  return task;
}

function extractTextBody(body: Record<string, unknown>): string | undefined {
  const text = body["text"];
  if (typeof text !== "object" || text === null) return undefined;
  const inner = (text as Record<string, unknown>)["body"];
  return typeof inner === "string" ? inner : undefined;
}

function extractMediaId(
  body: Record<string, unknown>,
  type: "image" | "video" | "audio" | "document" | "sticker"
): string | undefined {
  const media = body[type];
  if (typeof media !== "object" || media === null) return undefined;
  const id = (media as Record<string, unknown>)["id"];
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function extractInteractiveReplyId(
  body: Record<string, unknown>,
  kind: "button_reply" | "list_reply"
): string | undefined {
  const interactive = body["interactive"];
  if (typeof interactive !== "object" || interactive === null) return undefined;
  const reply = (interactive as Record<string, unknown>)[kind];
  if (typeof reply !== "object" || reply === null) return undefined;
  const id = (reply as Record<string, unknown>)["id"];
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function extractLocation(body: Record<string, unknown>): AgentTask["location"] {
  const loc = body["location"];
  if (typeof loc !== "object" || loc === null) return undefined;
  const r = loc as Record<string, unknown>;
  const latitude = r["latitude"];
  const longitude = r["longitude"];
  if (typeof latitude !== "number" || typeof longitude !== "number") return undefined;
  const out: NonNullable<AgentTask["location"]> = { latitude, longitude };
  if (typeof r["name"] === "string") out.name = r["name"];
  if (typeof r["address"] === "string") out.address = r["address"];
  return out;
}
