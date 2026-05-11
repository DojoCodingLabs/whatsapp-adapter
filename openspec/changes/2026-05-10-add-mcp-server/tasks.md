## 1. Phase C0 — workspace refactor + SDK rename (ships `@dojocoding/whatsapp-sdk@0.8.0`)

This phase combines three changes that must land atomically: (a)
introduce the pnpm workspace, (b) rename the SDK package, (c)
relocate the existing docs into `docs/sdk/` so the new
`docs/mcp/` and `docs/cookbook/hybrid/` subtrees can be created
in Phase C3 against a stable shape.

### 1.1 Workspace + folder moves

- [ ] 1.1.1 Create `pnpm-workspace.yaml` declaring `packages/*`.
- [ ] 1.1.2 Move SDK code into `packages/whatsapp-sdk/`: `src/`, `test/`, `tsup.config.ts`, `vitest.config.ts`, `package.json`, `CHANGELOG.md`, `LICENSE`, `README.md`. Use `git mv` to preserve history. Do NOT move `dist/` (regenerable; will land on build).
- [ ] 1.1.3 Move the existing `eslint.config.mjs`, `.prettierrc`, root `tsconfig.json` to the workspace root (shared tooling) and add a thin `packages/whatsapp-sdk/tsconfig.json` that extends the root and sets local options.
- [ ] 1.1.4 Replace root `package.json` with a workspace root: `"private": true`, only devDependencies that all packages need (eslint, prettier, typescript, lint-staged, simple-git-hooks, size-limit, vitest peer). Keep `simple-git-hooks` + `lint-staged` config at root.

### 1.2 SDK rename

- [ ] 1.2.1 In `packages/whatsapp-sdk/package.json`: change `"name"` from `"@dojocoding/whatsapp"` to `"@dojocoding/whatsapp-sdk"`. Bump `"version"` from `"0.7.4"` to `"0.8.0"`. Update the `"description"`, `"homepage"`, `"repository.directory"` fields.
- [ ] 1.2.2 Update internal source: no source file imports the package by name (all imports are relative `../foo`); confirm via `grep -rE "from ['\"]@dojocoding/whatsapp['\"]" packages/whatsapp-sdk/src packages/whatsapp-sdk/test` returns nothing.
- [ ] 1.2.3 Update SDK CHANGELOG with a `[0.8.0]` entry titled "Renamed package from `@dojocoding/whatsapp` to `@dojocoding/whatsapp-sdk`" — document the one-line `package.json` migration + the find-and-replace import update.
- [ ] 1.2.4 Update SDK README to lead with the new package name and add the sibling-package callout pointing at `@dojocoding/whatsapp-mcp` (the callout can read "Coming soon — see Phase C1" until C1 lands).

### 1.3 MCP package skeleton

- [ ] 1.3.1 Create `packages/whatsapp-mcp/` skeleton:
  - `src/index.ts` (empty barrel exporting `{}`)
  - `src/cli.ts` (shebang + `console.error("@dojocoding/whatsapp-mcp not yet implemented")` placeholder + `process.exit(1)`)
  - `package.json` at version `0.1.0` (shape below)
  - `tsup.config.ts` (entries: `src/index.ts`, `src/cli.ts`; format: `esm` + `cjs` for index, `cjs` only for cli; `banner: "#!/usr/bin/env node"` on cli; `chmod +x` step in `onSuccess`)
  - `vitest.config.ts` (extends shared base)
  - `CHANGELOG.md` (empty `[Unreleased]`)
  - `README.md` (one-paragraph stub: "MCP server skeleton — coming in Phase C1.")
  - `tsconfig.json` (extends root)
- [ ] 1.3.2 Confirm `pnpm install` at the workspace root resolves `@dojocoding/whatsapp-sdk` from the local package via `workspace:*`.

### 1.4 Docs reorganisation (mechanical move; fill-out in C3)

- [ ] 1.4.1 Move every file currently under `docs/` to `docs/sdk/` EXCEPT the cross-cutting ones (`architecture.md`, `compliance.md`, `compatibility.md`) which stay at `docs/`. The cookbook folder moves: `docs/cookbook/*.md` → `docs/cookbook/sdk/*.md`.
- [ ] 1.4.2 Create empty placeholder subdirectories: `docs/mcp/`, `docs/cookbook/mcp/`, `docs/cookbook/hybrid/`. Each gets a one-line `README.md` saying "Coming in Phase C3."
- [ ] 1.4.3 Update internal doc cross-links in the moved files: any `[…](./client.md)` becomes `[…](./client.md)` if the link target is also in `sdk/`; cross-cutting refs (`architecture.md`) become `[…](../architecture.md)`.
- [ ] 1.4.4 Update the root README to reflect the new workspace structure: replace the old "Quick start" with a placeholder pointing at `docs/README.md` (which is also Phase-C3-deferred for now) and a brief two-package callout.

### 1.5 CI / release workflow updates

- [ ] 1.5.1 Update `.github/workflows/ci.yml`: install at workspace root (`pnpm install --frozen-lockfile`), then run lint/typecheck/test/build/size with a matrix step per package. Pack-contents check runs once per package via the matrix; update the SDK's pack-contents assertion to use the new package name in the tarball path (`@dojocoding/whatsapp-sdk-X.Y.Z.tgz` → `package/dist/index.js`).
- [ ] 1.5.2 Update `.github/workflows/release.yml`: parse the tag prefix; `sdk-v*` → `packages/whatsapp-sdk/` and `mcp-v*` → `packages/whatsapp-mcp/`. Add a tag-version guard step that hard-fails if the parsed version from the tag doesn't match the package's `package.json` `"version"`.
- [ ] 1.5.3 Update `.github/workflows/openspec.yml` to run from the workspace root.
- [ ] 1.5.4 Update `.github/workflows/codeql.yml` (the path filters were repo-relative; they continue to work but verify).
- [ ] 1.5.5 Update `.github/dependabot.yml`: add a second `package-ecosystem: npm` block for `packages/whatsapp-mcp/`. Update the existing SDK block path to `/packages/whatsapp-sdk`.
- [ ] 1.5.6 Update `size-limit` config: SDK keeps its 7 budgets (re-root paths to `packages/whatsapp-sdk/dist/...`); MCP adds two budgets — `packages/whatsapp-mcp/dist/cli.js` (250 KB) and `packages/whatsapp-mcp/dist/index.js` (200 KB). The MCP budget is a placeholder for the skeleton — Phase C1 will tighten it once real code ships.

### 1.6 Verification + commit + release

- [ ] 1.6.1 Run the full gate at root: `pnpm -r typecheck && pnpm -r lint && pnpm -r format:check && pnpm -r test && pnpm -r build && pnpm -r size`. All 572 SDK tests pass unchanged.
- [ ] 1.6.2 Run `pnpm -r pack --pack-destination /tmp` and verify both tarballs unpack with the expected file lists. The SDK pack-contents Vitest test (which runs `pnpm pack` in `beforeAll`) still passes after the rename.
- [ ] 1.6.3 Commit as `refactor(workspace): convert to pnpm workspace; rename @dojocoding/whatsapp to @dojocoding/whatsapp-sdk; reorganise docs under sdk/`. Push.
- [ ] 1.6.4 Wait for CI green on the workspace SHA.
- [ ] 1.6.5 Tag `sdk-v0.8.0`. Push tag. Release workflow publishes `@dojocoding/whatsapp-sdk@0.8.0` from `packages/whatsapp-sdk/` with provenance.
- [ ] 1.6.6 After publish completes, run `npm deprecate "@dojocoding/whatsapp@*" "Renamed to @dojocoding/whatsapp-sdk. Replace your import and bump to ^0.8.0."` from a workspace-authenticated shell (or add it as a one-shot CI step gated on the tag).
- [ ] 1.6.7 Verify `npm view @dojocoding/whatsapp-sdk version` returns `0.8.0` and that `npm view @dojocoding/whatsapp deprecated` returns the deprecation message.

### Canonical `packages/whatsapp-mcp/package.json` shape

```json
{
  "name": "@dojocoding/whatsapp-mcp",
  "version": "0.1.0",
  "description": "MCP server exposing @dojocoding/whatsapp-sdk's outbound surface to LLM agents (Claude Desktop, Claude Agent SDK, Cursor, Cline).",
  "license": "MIT",
  "author": "Dojo Coding LLC",
  "homepage": "https://github.com/DojoCodingLabs/whatsapp-adapter/tree/main/packages/whatsapp-mcp#readme",
  "repository": { "type": "git", "url": "git+https://github.com/DojoCodingLabs/whatsapp-adapter.git", "directory": "packages/whatsapp-mcp" },
  "keywords": ["mcp", "model-context-protocol", "whatsapp", "claude", "agent", "llm"],
  "type": "module",
  "engines": { "node": ">=20" },
  "publishConfig": { "access": "public", "provenance": true },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./package.json": "./package.json"
  },
  "bin": { "dojo-whatsapp-mcp": "./dist/cli.js" },
  "files": ["dist", "LICENSE", "README.md", "CHANGELOG.md"],
  "scripts": { "...": "..." },
  "dependencies": {
    "@dojocoding/whatsapp-sdk": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.25.76",
    "zod-to-json-schema": "^3.24.0"
  }
}
```

`workspace:*` resolves to the local SDK package during dev; pnpm
rewrites it to a fixed range (`^0.8.0`) at publish time.

## 2. Phase C1 — MCP server core + first 6 tools (ships `@dojocoding/whatsapp-mcp@0.1.0`)

### 2.1 Core scaffolding

- [ ] 2.1.1 Implement `packages/whatsapp-mcp/src/env.ts`: `loadConfigFromEnv(argv?)` reads env + CLI flags, returns `{ accessToken, phoneNumberId, businessAccountId?, apiVersion?, appSecret? }`. Throws on missing required fields with a clear stderr-friendly message. Unit test all rejection paths.
- [ ] 2.1.2 Implement `packages/whatsapp-mcp/src/errors.ts`: `mapSdkError(e)` returns `{ content, isError: true, structuredContent }` for each `WhatsAppError` subclass with a per-subclass `formatForLlm` recovery hint. Unit test every subclass mapping.
- [ ] 2.1.3 Implement `packages/whatsapp-mcp/src/server.ts`: `buildServer({ client, mcpOptions? })` returns a `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`. Registers tools/resources/prompts. Sets server info `{ name: "whatsapp", version: <pkg version>, instructions }`.
- [ ] 2.1.4 Implement `packages/whatsapp-mcp/src/index.ts` exports: `WhatsAppMcpServer` (a class wrapping `buildServer` that also exposes `connect(transport)` and `close()`), `buildServer`, the tool schemas (typed re-exports for consumers who want to validate inputs themselves).
- [ ] 2.1.5 Implement `packages/whatsapp-mcp/src/cli.ts`: shebang line, `loadConfigFromEnv`, instantiate `WhatsAppClient`, instantiate `WhatsAppMcpServer({ client })`, connect to `StdioServerTransport`. All non-fatal logs go to `console.error`. Tsup `banner` config injects the shebang and the build step chmods `+x`.
- [ ] 2.1.6 Implement `packages/whatsapp-mcp/src/output-schemas.ts`: shared output schemas. The base `SendResult` is `z.object({ messageId: z.string(), recipientPhone: z.string(), wabaPhoneNumberId: z.string() })`. Read tools have their own shapes.

### 2.2 First 6 tools (one file per tool under `src/tools/`)

- [ ] 2.2.1 `send-text.ts`: schema `{ to: z.string(), body: z.string().min(1).max(4096), previewUrl: z.boolean().optional(), replyTo: z.string().optional() }`. Annotations: none. Handler: `client.sendText({ to, body, previewUrl, replyTo })`.
- [ ] 2.2.2 `send-image.ts`: schema accepts either `link` or `id`, plus `caption?`, `replyTo?`. Handler calls `client.sendImage`.
- [ ] 2.2.3 `send-template.ts`: schema `{ to, name, language, components?, replyTo? }`. Components reuse the SDK's exported zod schema where possible. Window-exempt.
- [ ] 2.2.4 `send-reaction.ts`: schema `{ to, messageId, emoji }`. Annotations: `idempotentHint: true`. Window-exempt.
- [ ] 2.2.5 `list-templates.ts`: schema `{ limit?: z.number().int().min(1).max(100), after?: z.string() }`. Annotations: `readOnlyHint: true`. Handler calls `client.listTemplates(...)`.
- [ ] 2.2.6 `get-template.ts`: schema `{ templateId: z.string() }`. Annotations: `readOnlyHint: true`. Handler calls `client.getTemplate(templateId)`.

### 2.3 Tests

- [ ] 2.3.1 Unit tests for `env.ts` and `errors.ts` (every subclass mapping).
- [ ] 2.3.2 Contract tests using `InMemoryTransport` from `@modelcontextprotocol/sdk/inMemory.js`. Pair the in-memory transport with a `WhatsAppMcpServer` backed by `MockWhatsAppClient`. For each of the 6 tools, drive an `initialize` + `tools/list` + `tools/call` round trip and assert `structuredContent` and `isError` shape.
- [ ] 2.3.3 `public-surface.test.ts`: asserts the registered tool names list matches exactly the 6 tools above (drift detector).
- [ ] 2.3.4 Build + size budget: `pnpm build && pnpm size` passes.

### 2.4 Ship

- [ ] 2.4.1 Update `packages/whatsapp-mcp/CHANGELOG.md` with `[0.1.0]` entry.
- [ ] 2.4.2 Commit as `feat(whatsapp-mcp): C1 — core + 6 tools`.
- [ ] 2.4.3 Push, wait for CI green on the bump SHA.
- [ ] 2.4.4 Tag `mcp-v0.1.0`. Push tag. Release workflow detects the prefix, builds + publishes `@dojocoding/whatsapp-mcp@0.1.0` from `packages/whatsapp-mcp/`. Confirm npm publish + provenance.

## 3. Phase C2 — remaining 10 tools + resources + prompt (ships `@dojocoding/whatsapp-mcp@0.2.0`)

### 3.1 Remaining 10 tools

- [ ] 3.1.1 `send-video.ts`
- [ ] 3.1.2 `send-audio.ts`
- [ ] 3.1.3 `send-voice.ts`
- [ ] 3.1.4 `send-document.ts`
- [ ] 3.1.5 `send-location.ts`
- [ ] 3.1.6 `send-contacts.ts`
- [ ] 3.1.7 `send-interactive-buttons.ts`
- [ ] 3.1.8 `send-interactive-list.ts`
- [ ] 3.1.9 `send-auth-template.ts`
- [ ] 3.1.10 `send-carousel-template.ts`

Each follows the C1 pattern: schema + annotations + handler + unit + contract test row + public-surface entry.

### 3.2 Resources

- [ ] 3.2.1 Register `whatsapp://window/{phone}`. Handler reads `client.windowTracker.isWindowOpen(phone)`. Returns `{ phone, isOpen }`. Resource description warns that in-memory storage returns "closed for every phone" until inbound traffic populates the tracker.
- [ ] 3.2.2 Register `whatsapp://templates`. Handler calls `client.listTemplates({ limit: 100 })`. 60-second in-process cache to avoid hammering Meta's Graph API. Resource description notes the cache TTL.
- [ ] 3.2.3 Contract test: `resources/list` returns both URI schemes. `resources/read` against each returns the expected payload.

### 3.3 Prompt

- [ ] 3.3.1 Register `wa-template-send`. Argsschema `{ templateName?: string, recipientPhone?: string }`. Emits a `messages[]` instructing Claude to read `whatsapp://templates` if needed, then `whatsapp_get_template`, then ask the user for variables, then call `whatsapp_send_template`.
- [ ] 3.3.2 Contract test: `prompts/list` returns `wa-template-send`. `prompts/get` returns the expected `messages` array.

### 3.4 Ship

- [ ] 3.4.1 Update CHANGELOG `[0.2.0]`.
- [ ] 3.4.2 Commit, push, CI green, tag `mcp-v0.2.0`, publish.

## 4. Phase C3 — docs fill-out (ships `@dojocoding/whatsapp-mcp@0.2.1`)

This phase fills out the doc tree skeleton created in Phase C0.
The MCP package's tarball-shipped README, the SDK's tarball
README, the cross-cutting docs, and the recipe set all land
here.

### 4.1 Tarball-shipped READMEs (the front doors)

Each follows the 5-section shape from design.md Decision 13.

- [ ] 4.1.1 Write `packages/whatsapp-mcp/README.md`:
  one-line description + sibling-package callout pointing at
  `@dojocoding/whatsapp-sdk` · install via `npx` + minimum
  `claude_desktop_config.json` snippet · 30-line happy-path
  showing a tool call · "What this package is / is NOT"
  (outbound-only, single WABA per process, no inbound surface)
  · link to `docs/mcp/` on GitHub.
- [ ] 4.1.2 Update `packages/whatsapp-sdk/README.md` to the
  same 5-section shape (it was already updated in C0 for the
  rename — this iteration polishes it): rebuild the
  happy-path example to use the new package name in imports,
  surface the sibling-package callout pointing at
  `@dojocoding/whatsapp-mcp`, link to `docs/sdk/`.

### 4.2 Cross-cutting docs at `docs/` root

- [ ] 4.2.1 Write `docs/README.md` — the doc index. Three top
  entry points: "I'm building a server" → `docs/sdk/quickstart.md`,
  "I'm building an agent" → `docs/mcp/quickstart.md`,
  "Both" → `docs/cookbook/hybrid/README.md`.
- [ ] 4.2.2 Write `docs/when-to-use-which.md` — the decision
  tree (load-bearing doc). Three top-level paths (server-only,
  agent-only, both) with one-paragraph "you want this when…"
  each.
- [ ] 4.2.3 Update `docs/architecture.md` to cover the system
  view: how SDK and MCP fit together; the canonical
  "agent triggers send → SDK receives reply → app routes back to
  agent" loop diagram; what state lives where.
- [ ] 4.2.4 Update `docs/compliance.md`, `docs/compatibility.md`
  to note (where applicable) that policies apply to both
  packages. Minimal edits.

### 4.3 MCP reference docs at `docs/mcp/`

- [ ] 4.3.1 `quickstart.md` — Claude Desktop config walkthrough
  end-to-end (token generation → config file location → first
  message). Repeats nothing from the README; this is the
  expanded version.
- [ ] 4.3.2 `tools.md` — all 16 tools listed with: input schema,
  output schema, when to use this tool vs an adjacent one,
  representative error recoveries. The full reference for an
  agent author or a tool-permission policy author.
- [ ] 4.3.3 `resources.md` — `whatsapp://window/{phone}`,
  `whatsapp://templates`. Cache semantics, in-memory-storage
  caveat, sample read.
- [ ] 4.3.4 `prompts.md` — `wa-template-send` walkthrough,
  argument shape, sample emitted `messages[]`.
- [ ] 4.3.5 `auth.md` — full env-var / CLI-flag table, the
  `claude_desktop_config.json` shape, multi-WABA via multiple
  server processes, where credentials should NOT go.
- [ ] 4.3.6 `error-recovery.md` — the full recovery-hint
  catalogue. For each `WhatsAppError` subclass: what the LLM
  sees, what the recovery hint suggests, the canonical "do this
  next" tool call. Cross-references `spec.md`.
- [ ] 4.3.7 `transports.md` — stdio (today, default), Streamable
  HTTP (future, deferred to v2), why SSE was deprecated.

### 4.4 MCP cookbook at `docs/cookbook/mcp/`

- [ ] 4.4.1 `claude-desktop.md` — full walkthrough including
  installing Claude Desktop, editing the config file on macOS /
  Windows / Linux, common gotchas (stdio framing, env
  propagation), end with "Claude sends your first message."
- [ ] 4.4.2 `claude-agent-sdk.md` — embedding `WhatsAppMcpServer`
  programmatically inside a Claude Agent SDK runtime. Shows the
  in-process transport path (no subprocess spawn) and how to
  surface the SDK's `Storage`-backed window state to the agent.
- [ ] 4.4.3 `multi-server-claude-desktop.md` — running N MCP
  servers from one Claude Desktop config (one per WABA), how
  to name them clearly, the `command/args/env` template.

### 4.5 Hybrid cookbook at `docs/cookbook/hybrid/` (the showcase)

These three recipes are the load-bearing demonstration of why
the two packages exist together.

- [ ] 4.5.1 `agent-handoff-loop.md` — the canonical full loop:
  agent triggers outbound template send via MCP →
  customer replies → consumer's app receives the webhook via
  the SDK's `WebhookReceiver` → consumer feeds the message back
  into the agent's runtime (showing the Claude Agent SDK
  `addToolResult` pattern). End-to-end TypeScript code.
- [ ] 4.5.2 `inbound-routed-to-agent.md` — inbound-first
  variant: SDK receives a customer message, an intent
  classifier (LLM call) decides whether to escalate to an MCP
  agent, the agent drives subsequent steps. Shows the
  classifier prompt + the routing logic.
- [ ] 4.5.3 `compliance-broadcast.md` — server-side compliance
  enforcement: agent triggers a marketing-template broadcast
  via MCP, the consumer's app intercepts (via SDK's
  Express/Hono middleware) to validate against a consent
  ledger before the send actually fires. Shows where the
  policy gate lives (consumer app, not MCP server).

### 4.6 SDK cookbook freshness pass at `docs/cookbook/sdk/`

The existing 7 recipes were moved in Phase C0; this iteration
audits them.

- [ ] 4.6.1 Audit each of the 7 moved recipes for stale
  references to `@dojocoding/whatsapp` (rename), now-incorrect
  doc cross-links, and out-of-date version numbers in code
  blocks. Update.
- [ ] 4.6.2 Add a "see also" footer to each linking the most
  relevant hybrid recipe (e.g.
  `two-way-support-with-handoff.md` → see
  `hybrid/agent-handoff-loop.md`).

### 4.7 Root README rebuild

- [ ] 4.7.1 Rewrite the repo root `README.md` around the
  two-package architecture. Open with a one-sentence pitch, a
  two-column capabilities table (SDK columns, MCP columns), and
  a small ASCII diagram showing how the two pieces fit.
  Include the canonical `claude_desktop_config.json` snippet
  for the MCP package. Link to `docs/when-to-use-which.md` as
  the first deep link.

### 4.8 Final fact-check pass

- [ ] 4.8.1 Run a project-wide grep for `@dojocoding/whatsapp`
  (without `-sdk`/`-mcp` suffix) and replace stale references.
  Allowed exceptions: the rename CHANGELOG entry, the
  `npm deprecate` command in release scripts.
- [ ] 4.8.2 Run a project-wide grep for paths under `src/` (vs
  `packages/whatsapp-sdk/src/`) and update any stragglers in
  docs.
- [ ] 4.8.3 Update CHANGELOG `[0.2.1]` for the MCP package
  (docs-only).

### 4.9 Ship

- [ ] 4.9.1 Commit, push, CI green, tag `mcp-v0.2.1`, publish.

## 5. Archive

- [ ] 5.1 Run `openspec validate --strict` on the change directory.
- [ ] 5.2 Move the change directory to `openspec/changes/archive/2026-05-10-add-mcp-server/`.
- [ ] 5.3 Confirm `openspec/specs/mcp-server/spec.md` is the canonical capability spec going forward.
