import { WhatsAppError } from "../types/errors.js";

import { request, type RequestOptions } from "./transport.js";
import type { WhatsAppClient } from "./whatsapp-client.js";

export interface TokenInfo {
  /** Whether Meta considers the token currently usable. */
  valid: boolean;
  /**
   * Token expiration, expressed as Unix epoch milliseconds. `null` when
   * Meta returns 0 or omits the field (some long-lived tokens never expire).
   */
  expiresAt: number | null;
  appId: string | null;
  userId: string | null;
  scopes: ReadonlyArray<string>;
}

/** Meta's `GET /debug_token` response shape (`data` envelope). */
interface DebugTokenResponse {
  data?: {
    is_valid?: boolean;
    expires_at?: number;
    app_id?: string;
    user_id?: string;
    scopes?: ReadonlyArray<string>;
    error?: { code?: number; message?: string };
  };
}

/**
 * Health-check the bearer token via `GET /debug_token`.
 *
 * Resolves with a `TokenInfo` when the token is valid; throws a
 * `WhatsAppError` when the call fails or Meta reports `is_valid: false`.
 */
export async function healthCheck(
  client: WhatsAppClient,
  options: RequestOptions = {}
): Promise<TokenInfo> {
  const token = client._getBearerToken();
  const path = `/debug_token?input_token=${encodeURIComponent(token)}`;
  const response = await request<DebugTokenResponse>(client, "GET", path, undefined, options);
  const data = response.data;
  if (!data || data.is_valid !== true) {
    const message =
      data?.error?.message ?? "Token validation failed: Meta /debug_token returned is_valid=false";
    throw new WhatsAppError("UNKNOWN", message);
  }
  return {
    valid: true,
    expiresAt:
      typeof data.expires_at === "number" && data.expires_at > 0 ? data.expires_at * 1000 : null,
    appId: data.app_id ?? null,
    userId: data.user_id ?? null,
    scopes: data.scopes ?? [],
  };
}
