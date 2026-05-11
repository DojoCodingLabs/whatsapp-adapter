## 1. Phase 1 — wire `WHATSAPP_MODE` into the bin

- [ ] 1.1 Add `WHATSAPP_MODE` (`"real" | "mock"`, default `"real"`) to `McpServerConfig` in `packages/whatsapp-mcp/src/env.ts`.
- [ ] 1.2 Add a CLI flag `--mode` mapping to the same field (parser already supports CLI-flag aliases).
- [ ] 1.3 Read the value in `loadConfigFromEnv`; normalise unknown values to `"real"` with a stderr warning (matches `MCP_LOG_LEVEL` parsing).
- [ ] 1.4 Update `packages/whatsapp-mcp/src/cli.ts`: replace `new WhatsAppClient({...})` with `pickWhatsAppClient({...})`; pass `forceMock: config.mode === "mock"` so the factory honours the explicit choice rather than re-reading process.env (deterministic).
- [ ] 1.5 In `cli.ts`, write `MOCK MODE — preview only; no Meta calls\n` to stderr when `config.mode === "mock"`.
- [ ] 1.6 Add unit tests in `packages/whatsapp-mcp/test/unit/env.test.ts`:
  - default mode is `"real"` when env var unset
  - `WHATSAPP_MODE=mock` parses to `"mock"`
  - `WHATSAPP_MODE=real` parses to `"real"`
  - unknown values (e.g. `WHATSAPP_MODE=preview`) normalise to `"real"`
  - CLI flag `--mode=mock` works
  - CLI flag overrides env var

## 2. Phase 2 — E2E spawn-the-bin suite

- [ ] 2.1 Create `packages/whatsapp-mcp/test/e2e/spawn-the-bin.test.ts` gated on `process.env.WHATSAPP_MCP_E2E === "1"` via `describe.skipIf(...)`.
- [ ] 2.2 `beforeAll` step: confirm `dist/cli.js` exists; if not, run `pnpm build` via `execFileSync`.
- [ ] 2.3 Helper `spawnBin({ env })`: returns `{ child, write(frame): void, readFrame(): Promise<JSONRPC>, stderr(): string[] }`. Uses newline-delimited JSON framing (no `Content-Length`).
- [ ] 2.4 Test: missing required env var → exit code 1 + stderr message naming the missing field (`WHATSAPP_ACCESS_TOKEN`).
- [ ] 2.5 Test: `initialize` handshake completes; server responds with capabilities including `tools`, `resources`, `prompts`.
- [ ] 2.6 Test: `tools/list` returns exactly the 16 expected tool names.
- [ ] 2.7 Test: `tools/call whatsapp_send_text` round-trips; response `structuredContent.messageId` matches `/^wamid\.mock-/` (mock-mode signal).
- [ ] 2.8 Test: stdout contains only valid JSON-RPC frames (each non-empty line parses as JSON). Stderr may contain the "MOCK MODE" banner + log lines; this assertion is on stdout only.
- [ ] 2.9 Test: process exits cleanly (`exit code 0`) when stdin is closed.
- [ ] 2.10 Each test sets per-test timeout of 10 s. Total suite ≤ 60 s.

## 3. Phase 3 — CI workflow for the E2E gate

- [ ] 3.1 New file `.github/workflows/mcp-e2e.yml`. Triggers: `workflow_dispatch` + `schedule: cron "0 7 * * *"`.
- [ ] 3.2 Job runs on `ubuntu-latest` (NOT Blacksmith — maximum fidelity to what npm users see).
- [ ] 3.3 Steps: checkout → pnpm install → build SDK → build MCP → run `WHATSAPP_MCP_E2E=1 pnpm --filter @dojocoding/whatsapp-mcp test test/e2e/`.
- [ ] 3.4 Upload the test stderr capture as an artifact on failure (for post-mortem).
- [ ] 3.5 Workflow does NOT depend on Meta credentials; no `secrets.NPM_TOKEN` needed.

## 4. Phase 4 — coverage config + docs + ship

### 4.1 Coverage

- [ ] 4.1.1 In `packages/whatsapp-mcp/vitest.config.ts`: replace the hard-coded `src/cli.ts` exclusion with a conditional one — excluded under PR CI (default), included when `WHATSAPP_MCP_E2E=1`. Document the rationale inline.

### 4.2 Docs

- [ ] 4.2.1 `docs/mcp/auth.md` — add `WHATSAPP_MODE` row to the optional-env-vars table. New "## Preview / mock mode" section showing the canonical Claude Desktop config snippet with `WHATSAPP_MODE: "mock"` set and placeholder credentials.
- [ ] 4.2.2 `docs/mcp/quickstart.md` — add a "## Try without a real WABA" section near the top, calling out the mock-mode workflow for setup-verification before provisioning a real WABA.
- [ ] 4.2.3 `docs/mcp/transports.md` — add a "## Testing the spawned bin" subsection pointing at the E2E suite + the `WHATSAPP_MCP_E2E=1` gate + the mock-mode flag.

### 4.3 Ship

- [ ] 4.3.1 Bump `packages/whatsapp-mcp/package.json` version → `0.3.0` (env-var surface addition is a feature).
- [ ] 4.3.2 Add `[0.3.0]` CHANGELOG entry covering the new env var + CLI flag + E2E suite.
- [ ] 4.3.3 Run the full gate: `pnpm -r typecheck && pnpm -r lint && pnpm format:check && pnpm -r test && pnpm -r size`.
- [ ] 4.3.4 Manually verify the E2E suite passes locally: `WHATSAPP_MCP_E2E=1 pnpm --filter @dojocoding/whatsapp-mcp test test/e2e/`.
- [ ] 4.3.5 Commit, push, wait for CI green on the bump SHA.
- [ ] 4.3.6 Tag `mcp-v0.3.0`. Push tag. Release workflow publishes from `packages/whatsapp-mcp/` with provenance.
- [ ] 4.3.7 Trigger the new `mcp-e2e.yml` workflow manually after publish to verify it works in CI.

## 5. Archive

- [ ] 5.1 Run `openspec validate 2026-05-11-add-mcp-mock-mode-and-e2e --strict`.
- [ ] 5.2 Archive: `openspec archive 2026-05-11-add-mcp-mock-mode-and-e2e --yes`.
- [ ] 5.3 Confirm `openspec/specs/mcp-server/spec.md` now contains the two updated requirements.
