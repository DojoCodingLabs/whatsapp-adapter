import type { ListTemplatesResponse, WhatsAppLikeClient } from "@dojocoding/whatsapp-sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ReadResourceResult, ResourceDefinition } from "../types.js";

export const TEMPLATES_RESOURCE_URI = "whatsapp://templates";
export const TEMPLATES_RESOURCE_NAME = "whatsapp-templates";
export const TEMPLATES_CACHE_TTL_MS = 60_000;

export const templatesResourceDefinition: ResourceDefinition = {
  name: TEMPLATES_RESOURCE_NAME,
  uri: TEMPLATES_RESOURCE_URI,
  title: "Approved WhatsApp templates (cached 60s)",
  description:
    "Lists approved message templates for the bound WABA. Cached in-process for 60 seconds — a recent admin-side template approval may not appear until the cache expires. Use the returned `id` with `whatsapp_get_template` to inspect parameter slots, or pair with `whatsapp_send_template`.",
  mimeType: "application/json",
};

interface CacheEntry {
  fetchedAt: number;
  body: string;
}

/**
 * Build a `whatsapp://templates` reader closure that caches the
 * upstream `client.listTemplates({limit:100})` result for
 * {@link TEMPLATES_CACHE_TTL_MS} (60 seconds) in-process. The
 * caching is per-reader; pass the same closure to both the
 * stdio server and the embedded toolset to share state.
 */
export function buildTemplatesResourceReader(
  client: WhatsAppLikeClient,
  now: () => number = () => Date.now()
): (uri: string) => Promise<ReadResourceResult> {
  let cache: CacheEntry | undefined;

  return async (uri: string) => {
    const t = now();
    if (!cache || t - cache.fetchedAt >= TEMPLATES_CACHE_TTL_MS) {
      const response: ListTemplatesResponse = await client.listTemplates({ limit: 100 });
      cache = {
        fetchedAt: t,
        body: JSON.stringify({
          data: response.data.map((tpl) => ({
            id: tpl.id,
            name: tpl.name,
            language: tpl.language,
            category: tpl.category,
            status: tpl.status,
          })),
          cachedAt: new Date(t).toISOString(),
          cacheTtlMs: TEMPLATES_CACHE_TTL_MS,
        }),
      };
    }
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: cache.body,
        },
      ],
    };
  };
}

/**
 * Resource `whatsapp://templates` — list approved templates for
 * the bound WABA.
 *
 * Backed by `client.listTemplates({ limit: 100 })`. Cached for
 * `TEMPLATES_CACHE_TTL_MS` (60 seconds) in-process to avoid
 * hammering Meta's Graph API when the model reads the resource
 * multiple times in quick succession. Templates rarely change at
 * sub-minute granularity in practice; the cache TTL is documented
 * in the resource description so the model knows reads can lag
 * a recent approval by up to a minute.
 */
export function registerTemplatesResource(
  server: McpServer,
  client: WhatsAppLikeClient,
  now: () => number = () => Date.now()
): void {
  const read = buildTemplatesResourceReader(client, now);

  server.registerResource(
    TEMPLATES_RESOURCE_NAME,
    TEMPLATES_RESOURCE_URI,
    {
      title: templatesResourceDefinition.title,
      description: templatesResourceDefinition.description,
      mimeType: templatesResourceDefinition.mimeType,
    },
    async (uri) => read(uri.toString())
  );
}
