## Why

The `@dojocoding/whatsapp-mcp` package's 106 tests cover the
server's **logic** — every tool handler, every error mapping,
every recovery hint, every resource read, every prompt
invocation, and a drift detector that pins the public surface.

What they don't cover is **packaging + runtime + protocol-on-wire**:

- The built `dist/cli.js` artefact. Tests run against TypeScript
  source via vitest; they never read the post-`tsup` output.
- Real stdio JSON-RPC framing. Contract tests use
  `InMemoryTransport.createLinkedPair()` from
  `@modelcontextprotocol/sdk` — JavaScript objects passed by
  reference, no byte serialization.
- Process spawn semantics. `npx -y @dojocoding/whatsapp-mcp`
  + the bin's `#!/usr/bin/env node` + the `chmod +x` post-step
  are entirely untested.
- Exit codes and stderr-only diagnostics. The env loader unit
  tests assert `throw McpConfigError`; nothing asserts the bin
  actually `process.exit(1)`s with a clean stderr message when
  the missing-credentials case fires.
- `console.log` regressions. Anyone adding a stray `console.log`
  in `cli.ts` would corrupt the host's JSON-RPC parser and
  break Claude Desktop, but no test catches this.

This change adds a **spawn-the-bin E2E test suite** gated on
`WHATSAPP_MCP_E2E=1` that exercises the entire pipeline: build →
spawn → real stdin/stdout → JSON-RPC parse → tool round-trip.

To make the E2E suite runnable without real Meta credentials
(and without burning sandbox WABA quota in CI), the bin gains a
`WHATSAPP_MODE=mock` env var that swaps `MockWhatsAppClient` in
via the SDK's existing `pickWhatsAppClient` factory. This
**doubles as a public developer feature** — anyone wiring up
Claude Desktop can now run the MCP server in preview mode
without a real WABA, useful for prompt-engineering iterations,
demos, and downstream consumer CI (e.g., Front Desk
orchestrator templates).

## What Changes

### Bin behaviour (`cli.ts`)

- **NEW** `WHATSAPP_MODE` env var, values `"real"` (default) or
  `"mock"`. Read by the existing `loadConfigFromEnv` loader;
  passed through to a new factory call.
- **MODIFIED** `cli.ts` swaps `new WhatsAppClient(...)` for
  `pickWhatsAppClient({...})` (the SDK's existing factory).
  When `WHATSAPP_MODE=mock` is set, the factory returns
  `MockWhatsAppClient`; otherwise the real client. Zero-cost
  for production callers — same behaviour as today.
- **NEW** CLI flag `--mode=mock` as a non-env-var alternative,
  matching the existing flag pattern for the other env vars.
- **PRESERVED** every other config requirement: the env loader
  still rejects missing required fields (token, phone-number-id)
  at startup; the mock-mode credentials can be any non-empty
  strings since the mock never validates them.

### Tests

- **NEW** `packages/whatsapp-mcp/test/e2e/spawn-the-bin.test.ts`
  gated on `WHATSAPP_MCP_E2E=1`. Builds the package fresh,
  spawns `node dist/cli.js` with `WHATSAPP_MODE=mock`, drives
  JSON-RPC over real stdio, asserts:
  - `initialize` handshake completes.
  - `tools/list` returns the 16 expected tool names.
  - `tools/call whatsapp_send_text` round-trips and the response
    `structuredContent.messageId` matches `/^wamid\.mock-/`.
  - Missing required env vars → exit 1 + stderr message naming
    the missing field.
  - Stdout contains only valid JSON-RPC frames (no
    `console.log` leakage).
  - Process exits cleanly on stdin close.
- **NEW** unit tests for the `WHATSAPP_MODE` parsing in
  `env.test.ts`.
- **MODIFIED** `vitest.config.ts` — remove `src/cli.ts` from
  the coverage exclusion. Once the E2E suite exercises it, the
  exclusion is no longer needed (coverage will report from
  whatever runs with `WHATSAPP_MCP_E2E=1`).

### CI

- **NEW** `.github/workflows/mcp-e2e.yml` — manually
  triggerable (workflow_dispatch) + scheduled nightly.
  Sets `WHATSAPP_MCP_E2E=1` and runs the E2E suite. Does NOT
  run on every PR (too slow: ~10-15 s per test × 6 tests).
  Job is **not** gated on Meta credentials — the mock-mode
  flag makes it self-contained.
- **PRESERVED** the existing `.github/workflows/ci.yml` runs
  on every push/PR and does NOT include E2E.

### Docs

- **MODIFIED** `docs/mcp/auth.md` — add `WHATSAPP_MODE` to the
  optional-env-vars table; new section "Preview / mock mode"
  showing the canonical `claude_desktop_config.json` snippet.
- **MODIFIED** `docs/mcp/quickstart.md` — add a "Try without a
  real WABA" section calling out the mock-mode workflow for
  initial setup.
- **MODIFIED** `docs/mcp/transports.md` — add a "Testing the
  spawned bin" subsection pointing at the E2E suite + the
  mock-mode flag.

## Capabilities

### Modified Capabilities

- `mcp-server` (single spec at
  `openspec/specs/mcp-server/spec.md`): modifies the
  "Configuration via environment variables" requirement to
  add `WHATSAPP_MODE`. Adds a new requirement covering the
  bin's spawn-and-stdio runtime contract.

### New Capabilities

None. This change extends the existing `mcp-server` spec; it
doesn't introduce a new capability.

## Non-goals

- **Real Meta integration testing.** Out of scope. That's the
  SDK's `WHATSAPP_E2E=1` gate, which remains externally blocked
  on a Meta test WABA. The MCP E2E suite **explicitly mocks
  the upstream** so the test fails for MCP-layer reasons or
  not at all — never for Meta-side flakiness.
- **Windows-specific E2E.** Shebang lines don't work on Windows
  natively (npm wraps them via `.cmd` shims). The E2E test
  invokes `node dist/cli.js` directly, bypassing the bin
  wrapper, on the assumption that this is what `npx` does
  under the hood on every platform. A Windows-specific test
  that invokes the `.cmd` wrapper is a v2 follow-up.
- **Coverage threshold raise.** Once `cli.ts` is back in the
  coverage tree, the MCP package's overall statements should
  rise slightly. We don't tighten the 95/65/95/95 thresholds
  in this change — measure first, ratchet later.

## Impact

- **Public API of `@dojocoding/whatsapp-mcp`**: one new env var
  + one new CLI flag, both optional, defaulting to existing
  behaviour. Non-breaking.
- **`@dojocoding/whatsapp-sdk`**: zero change. The bin already
  imports `pickWhatsAppClient` from the SDK; this is a
  consumer-side wiring change only.
- **Bundle size**: negligible. `MockWhatsAppClient` is in the
  SDK's tree-shaken dist; importing it through
  `pickWhatsAppClient` adds ~1-2 kB to the MCP CLI bundle.
- **Versioning**: MCP minor bump to `0.3.0` (env-var surface
  addition is a feature). Tag prefix `mcp-v0.3.0`.
- **Coverage**: MCP package's `cli.ts` exclusion lifted once
  E2E exercises it. Measurable statement coverage rises from
  98.6% (current, with `cli.ts` excluded) to ≥98.6% (no
  exclusion needed; `cli.ts` itself becomes covered).
- **CI runtime**: zero change on PRs — the E2E job is opt-in.
  Manual workflow_dispatch + nightly schedule only.
- **Developer experience**: a new public feature — preview
  mode for the MCP bin without a real WABA. Documented in
  three doc pages.
