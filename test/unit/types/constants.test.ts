import { describe, expect, it } from "vitest";

import {
  GRAPH_API_VERSION,
  META_GRAPH_BASE_URL,
  WEBHOOK_ACK_DEADLINE_MS,
  WINDOW_TTL_MS,
} from "../../../src/types/constants.js";

describe("constants", () => {
  it("GRAPH_API_VERSION matches /^v\\d+\\.\\d+$/", () => {
    expect(GRAPH_API_VERSION).toMatch(/^v\d+\.\d+$/);
    expect(GRAPH_API_VERSION).toBe("v23.0");
  });

  it("META_GRAPH_BASE_URL is the canonical Graph API origin", () => {
    expect(META_GRAPH_BASE_URL).toBe("https://graph.facebook.com");
  });

  it("WEBHOOK_ACK_DEADLINE_MS is exactly 30000", () => {
    expect(WEBHOOK_ACK_DEADLINE_MS).toBe(30_000);
  });

  it("WINDOW_TTL_MS is exactly 24h in milliseconds", () => {
    expect(WINDOW_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(WINDOW_TTL_MS).toBe(86_400_000);
  });
});
