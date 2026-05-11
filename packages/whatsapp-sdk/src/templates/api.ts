import type { RequestOptions } from "../client/transport.js";
import type { WhatsAppClient } from "../client/whatsapp-client.js";

import type { ListTemplatesQuery, ListTemplatesResponse, TemplateDefinition } from "./types.js";

/**
 * GET /{wabaId}/message_templates — list approved templates for a WABA.
 * The optional `query` is encoded as URL search params.
 */
export function listTemplates(
  client: WhatsAppClient,
  query: ListTemplatesQuery = {},
  options?: RequestOptions
): Promise<ListTemplatesResponse> {
  const path = `/${client.wabaId}/message_templates${buildQuery(query)}`;
  return client.request<ListTemplatesResponse>("GET", path, undefined, options);
}

/** GET /{templateId} — fetch a single template definition by id. */
export function getTemplate(
  client: WhatsAppClient,
  templateId: string,
  options?: RequestOptions
): Promise<TemplateDefinition> {
  if (typeof templateId !== "string" || templateId.length === 0) {
    throw new TypeError("getTemplate: templateId must be a non-empty string.");
  }
  const path = `/${templateId}`;
  return client.request<TemplateDefinition>("GET", path, undefined, options);
}

function buildQuery(query: ListTemplatesQuery): string {
  const entries: Array<[string, string]> = [];
  if (query.name !== undefined) entries.push(["name", query.name]);
  if (query.language !== undefined) entries.push(["language", query.language]);
  if (query.status !== undefined) entries.push(["status", query.status]);
  if (query.category !== undefined) entries.push(["category", query.category]);
  if (query.limit !== undefined) entries.push(["limit", String(query.limit)]);
  if (query.after !== undefined) entries.push(["after", query.after]);
  if (query.before !== undefined) entries.push(["before", query.before]);
  if (entries.length === 0) return "";
  return (
    "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
  );
}
