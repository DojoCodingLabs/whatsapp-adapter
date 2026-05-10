export const GRAPH_API_VERSION = "v23.0" as const;

export const META_GRAPH_BASE_URL = "https://graph.facebook.com" as const;

export const WEBHOOK_ACK_DEADLINE_MS = 30_000 as const;

export const WINDOW_TTL_MS = 24 * 60 * 60 * 1000;

export type GraphApiVersion = typeof GRAPH_API_VERSION | `v${number}.${number}`;
