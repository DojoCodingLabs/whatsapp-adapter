## 1. Phase 1 — refactor tool/resource/prompt files to expose `{definition, handler}` pairs

- [ ] 1.1 Define shared `ToolDefinition`, `ResourceDefinition`, `PromptDefinition`, `CallToolResult`, `DispatchContext` types in `packages/whatsapp-mcp/src/types.ts`.
- [ ] 1.2 Refactor each of the 16 tool files under `packages/whatsapp-mcp/src/tools/*.ts`:
  - Export a `<NAME>_TOOL: ToolDefinition` constant (name + description + zod inputSchema).
  - Export an `handle<Name>(client, args, ctx)` function returning `Promise<CallToolResult>`.
  - The function uses the existing `withErrorMapping(...)` helper for SDK→MCP error conversion.
- [ ] 1.3 Refactor `src/resources/window.ts` and `src/resources/templates.ts` to export `WINDOW_RESOURCE: ResourceDefinition` and `readWindowResource(uri, ctx)` (resp.).
- [ ] 1.4 Refactor `src/prompts/wa-template-send.ts` to export `WA_TEMPLATE_SEND: PromptDefinition` and `renderWaTemplateSend(args)`.
- [ ] 1.5 Update `WhatsAppMcpServer.register()` to consume the same `{definition, handler}` pairs (via a thin internal adapter `registerTool(server, {definition, handler})`).
- [ ] 1.6 Run existing test suite. ALL 112 in-process tests + the public-surface drift detector must pass unchanged.

## 2. Phase 2 — `createWhatsAppToolset` public surface

- [ ] 2.1 Implement `src/toolset.ts` exporting `createWhatsAppToolset(input): WhatsAppToolset`.
- [ ] 2.2 The factory builds:
  - `tools: ReadonlyArray<ToolDefinition>` — the 16 definitions in stable order.
  - `resources: ReadonlyArray<ResourceDefinition>` — 2 definitions.
  - `prompts: ReadonlyArray<PromptDefinition>` — 1 definition.
  - `dispatch(name, args, ctx?)` — name lookup → schema validate → handler invoke → result.
  - `readResource(uri)` — URI parse → reader invoke.
  - `renderPrompt(name, args?)` — name lookup → renderer invoke.
- [ ] 2.3 Schema validation: when `args` don't parse against the tool's zod inputSchema, return `{ isError: true, structuredContent: { error: { code: "invalid_args", message, recoveryHint } } }`. Identical to the stdio server's behaviour.
- [ ] 2.4 Name-not-found: when `name` doesn't match any registered tool, return `{ isError: true, structuredContent: { error: { code: "unknown_tool", message: "Tool <name> not found", recoveryHint } } }`.
- [ ] 2.5 `DispatchContext.requestId` is generated via `randomUUID()` when omitted.
- [ ] 2.6 Add the new export to `packages/whatsapp-mcp/src/index.ts` and update the public-surface drift detector.

## 3. Phase 3 — drift detector + contract tests

- [ ] 3.1 Add `packages/whatsapp-mcp/test/contract/embedded-toolset-parity.test.ts`:
  - Tool name set on the toolset === tool name set registered on a `WhatsAppMcpServer` instance.
  - Resource URI set on the toolset === resource URI set registered on a `WhatsAppMcpServer` instance.
  - Prompt name set on the toolset === prompt name set registered on a `WhatsAppMcpServer` instance.
  - Each toolset definition's `inputSchema` (zod) produces the same JSON Schema as the server-registered version.
- [ ] 3.2 Add `packages/whatsapp-mcp/test/contract/toolset-dispatch.test.ts`:
  - 16× happy-path: each tool dispatched via toolset returns the canonical success shape.
  - 16× SDK error path: each tool dispatched against a mock that throws a typed SDK error returns the canonical `isError: true + structuredContent.error` shape with the same `code` and `recoveryHint` the stdio server would produce.
  - Schema validation failure → `code: "invalid_args"`.
  - Unknown tool name → `code: "unknown_tool"`.
- [ ] 3.3 Add `packages/whatsapp-mcp/test/unit/toolset.test.ts` for the factory's input validation (missing client, etc.).

## 4. Phase 4 — docs + cookbook

- [ ] 4.1 Add `docs/mcp/embedded.md` covering: when to use the toolset (Vercel-style serverless, gateway merging, non-MCP callsites), the API, the byte-identical-surface guarantee, the relationship to `WhatsAppMcpServer`.
- [ ] 4.2 Add `docs/cookbook/mcp/embedded-toolset.md` — a Next.js App Router gateway recipe that merges our toolset with a hypothetical "Alegra" upstream and dispatches by `wa_*` prefix. ~40 lines of code, runnable.
- [ ] 4.3 Update `docs/mcp/README.md` to point at the embedded page.
- [ ] 4.4 Update `MIGRATION.md` § "MCP server: 0.3.x → 1.0.0" with a "What's new in 0.4.0" section.

## 5. Phase 5 — ship `mcp-v0.4.0`

- [ ] 5.1 Bump `packages/whatsapp-mcp/package.json` to `0.4.0`.
- [ ] 5.2 Add `## [0.4.0] — 2026-05-12` entry to `packages/whatsapp-mcp/CHANGELOG.md` covering the new surface + the internal refactor.
- [ ] 5.3 Verify full gate green: `pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm -r build && pnpm -r size && pnpm format:check`.
- [ ] 5.4 Verify size budget: `dist/index.js` for the library export grows but stays well under 200 KB brotlied.
- [ ] 5.5 Archive this change: `openspec archive 2026-05-12-mcp-embedded-toolset`.
- [ ] 5.6 Commit, push to main, wait for CI green on the bump SHA.
- [ ] 5.7 Tag `mcp-v0.4.0`, push tag, watch release workflow publish to npm with provenance.
- [ ] 5.8 `npm view @dojocoding/whatsapp-mcp version` returns `0.4.0`.
