/**
 * Shared type definitions for the package's two consumption
 * surfaces: the stdio `WhatsAppMcpServer` (wraps `McpServer`)
 * and the embedded `createWhatsAppToolset` (flat callable API).
 *
 * Both surfaces consume the same per-tool `{ definition, handler }`
 * pairs; this module exports the shape contract that pairs them.
 */

import type { z } from "zod";

/**
 * The zod-shape map (`Record<string, z.ZodTypeAny>`) that the MCP
 * SDK's `server.registerTool` accepts as `inputSchema` /
 * `outputSchema`. Equivalent to `z.object(shape).shape`.
 */
export type ZodShape = Record<string, z.ZodTypeAny>;

/**
 * MCP tool-call hints. Optional metadata the host may surface to
 * the model (e.g. "this tool is read-only / idempotent").
 */
export interface ToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly openWorldHint?: boolean;
}

/**
 * MCP `tools/list` entry. Mirrors the MCP SDK's tool-registration
 * fields plus a `name` (the MCP SDK API takes the name as a
 * separate argument; we co-locate it for flat enumeration).
 */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: ZodShape;
  readonly outputSchema?: ZodShape | undefined;
  readonly annotations?: ToolAnnotations | undefined;
}

/**
 * MCP `resources/list` entry. Either `uri` (fixed) or
 * `uriTemplate` (parameterised) is set, never both.
 */
export interface ResourceDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly mimeType: string;
  readonly uri?: string | undefined;
  readonly uriTemplate?: string | undefined;
}

/**
 * MCP `prompts/list` entry.
 */
export interface PromptDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly argsSchema?: ZodShape | undefined;
}

/**
 * Per-call context passed to dispatch / readResource / renderPrompt.
 * Carries cross-cutting state that wasn't in the args themselves.
 */
export interface DispatchContext {
  /**
   * Stable per-dispatch identifier for OTel correlation. When
   * omitted, the toolset's dispatch generates a UUID v4.
   */
  readonly requestId?: string;
  /**
   * Optional cancellation signal forwarded into outbound HTTP
   * (SDK already honours `RequestOptions.signal`).
   */
  readonly abortSignal?: AbortSignal;
}

/**
 * MCP `CallToolResult` shape — the response a tool returns. The
 * `isError: true` branch + `structuredContent.error.{code, message}`
 * follows the canonical recovery-hint contract documented in
 * `docs/mcp/error-recovery.md`.
 */
export interface CallToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * MCP `ReadResourceResult` shape. Each `contents[i]` is either a
 * `text` payload or a `blob` payload (mutually exclusive).
 */
export type ResourceContent =
  | { uri: string; mimeType?: string; text: string }
  | { uri: string; mimeType?: string; blob: string };

export interface ReadResourceResult {
  contents: ResourceContent[];
  [key: string]: unknown;
}

/**
 * MCP `GetPromptResult` shape. Carries an index signature
 * (`[x: string]: unknown`) so the type is assignable to the
 * MCP SDK's stricter internal result type, which permits
 * additional fields for forward-compat.
 */
export interface GetPromptResult {
  messages: Array<{
    role: "user" | "assistant";
    content: { type: "text"; text: string };
  }>;
  [key: string]: unknown;
}
