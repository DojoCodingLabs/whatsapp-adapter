# Changelog

All notable changes to `@dojocoding/whatsapp-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0 minor versions may contain breaking changes — see
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) § Releases.

## [0.3.0] — 2026-05-11

OpenSpec change `2026-05-11-add-mcp-mock-mode-and-e2e`.

### Added — `WHATSAPP_MODE=mock` preview / mock mode (developer feature)

A new `WHATSAPP_MODE` env var (and matching `--mode` CLI flag)
on the bin. Values:

- `"real"` (default) — uses `WhatsAppClient` against Meta's
  Graph API. Unchanged behaviour.
- `"mock"` — uses `MockWhatsAppClient` via the SDK's existing
  `pickWhatsAppClient` factory. No network calls, no Meta
  credentials validated, deterministic `wamid.mock-N` returns.

Unrecognised values (`WHATSAPP_MODE=preview`, etc.) fall back to
`"real"` with a stderr warning naming the bad value.

When `WHATSAPP_MODE=mock`, the bin writes `MOCK MODE — preview only; no Meta calls`
to stderr at startup so operators can confirm the mode they
booted into. **Stdout still contains only JSON-RPC frames**;
the discipline is unchanged.

**The tool / resource / prompt surface is byte-identical** to
real mode. The agent sees the same 16 tools, the same 2
resources, the same prompt. Only the upstream target differs.

Canonical Claude Desktop config for mock mode:

```json
{
  "mcpServers": {
    "whatsapp-preview": {
      "command": "npx",
      "args": ["-y", "@dojocoding/whatsapp-mcp"],
      "env": {
        "WHATSAPP_MODE": "mock",
        "WHATSAPP_ACCESS_TOKEN": "dev-only-not-used",
        "WHATSAPP_PHONE_NUMBER_ID": "dev-only-not-used"
      }
    }
  }
}
```

Use cases: setup-verification before provisioning a real WABA,
prompt-engineering iteration without burning Meta quota,
downstream consumer CI workflows.

### Added — spawn-the-bin E2E test suite (`WHATSAPP_MCP_E2E=1`)

`packages/whatsapp-mcp/test/e2e/spawn-the-bin.test.ts` — 8 tests
that spawn the built `dist/cli.js` as a real Node subprocess
and drive JSON-RPC over real stdio. Covers the
**packaging + runtime + protocol-on-wire** failure modes the
in-process contract suite can't reach:

- Shebang resolves (file invokable as a Node script).
- `chmod +x` was set (executable bit present).
- Missing required env vars → exit code 1 + stderr naming the
  missing field.
- `initialize` → `tools/list` returns the 16 expected tool
  names.
- `tools/call whatsapp_send_text` round-trips; response's
  `structuredContent.messageId` matches `/^wamid\.mock-\d+/`
  (the load-bearing mock-mode signal).
- Stdout contains only valid JSON-RPC frames (every non-empty
  line `JSON.parse`s).
- The `MOCK MODE` banner appears on stderr, never stdout.
- `WHATSAPP_MODE=preview` (unrecognised) falls back to real
  with a stderr warning.

Runtime: ~1.5 s for the full E2E suite (lower than the contract
suite — the spawn cost is amortized across 8 tests).

Gated on `WHATSAPP_MCP_E2E=1`. **Not run on every PR.** Triggers:

- New workflow `.github/workflows/mcp-e2e.yml` — manual
  `workflow_dispatch` + nightly schedule (07:00 UTC).
- Local: `WHATSAPP_MCP_E2E=1 pnpm --filter @dojocoding/whatsapp-mcp test test/e2e/`.

### Tests

Workspace test counts grow:

- MCP: 106 → 112 (+6 env-loader tests for mode parsing)
  - 8 E2E tests (skipped by default; run when gated).
    Total addressable: 120.
- SDK: unchanged at 586.

### Implementation notes

- The bin uses `pickWhatsAppClient({ forceMock: config.mode === "mock", ... })`
  instead of `new WhatsAppClient(...)`. The factory's existing
  behaviour does the dispatch; the MCP bin doesn't re-implement
  the env-var lookup logic.
- The `WHATSAPP_MODE` env-var name matches the SDK's existing
  `pickWhatsAppClient` convention — single source of truth.
- `src/cli.ts` stays excluded from coverage. v8 coverage runs
  in the test process, not subprocesses; the E2E test spawns
  cli.ts as a child and v8 doesn't trace through process
  boundaries. The exclusion is documented inline in
  `vitest.config.ts` with the rationale.

## [0.2.1] — 2026-05-11

### Documentation (no runtime change)

Phase C3 of OpenSpec change `2026-05-10-add-mcp-server`. Full
documentation fill-out around the two-package architecture.
No code changes to the published artefact — purely a docs +
README sweep.

- **New tarball-shipped README** at the 5-section shape from
  design.md Decision 13 (one-line description + sibling callout,
  install + Claude Desktop config, 30-line example, what is /
  isn't, link to docs).
- **New `docs/mcp/` reference tree** at the repo root:
  - `quickstart.md` — Claude Desktop in 5 minutes
  - `tools.md` — every tool's input / output / annotations
  - `resources.md` — `whatsapp://window/{phone}`, `whatsapp://templates`
  - `prompts.md` — `wa-template-send` walkthrough
  - `auth.md` — env vars, CLI flags, multi-WABA
  - `error-recovery.md` — full catalogue of recovery hints per `WhatsAppError` subclass
  - `transports.md` — stdio today, Streamable HTTP later
- **New `docs/cookbook/mcp/`:**
  - `claude-desktop.md` — install + first message walkthrough
  - `claude-agent-sdk.md` — embedding the server in-process via `InMemoryTransport`
  - `multi-server-claude-desktop.md` — one MCP server per WABA
- **New `docs/cookbook/hybrid/` (the load-bearing showcase):**
  - `agent-handoff-loop.md` — canonical agent ↔ customer loop
  - `inbound-routed-to-agent.md` — intent classification before LLM engagement
  - `compliance-broadcast.md` — consent-ledger gate on agent broadcasts
- **`docs/when-to-use-which.md`** — single-page decision tree.
- **`docs/README.md`** — doc index with three entry points.
- **`docs/architecture.md` expanded** with a system-view section
  showing how the two packages share `WhatsAppClient` +
  `WindowTracker` + `Storage`, plus an MCP-server-specific
  layout + flow diagram.
- Root `README.md` polished to drop the "Phase C3" forward
  references now that the docs landed.

## [0.2.0] — 2026-05-11

### Added

Phase C2 of OpenSpec change `2026-05-10-add-mcp-server`. Brings
the MCP server to its full v1 surface: 16 tools, 2 resources,
1 prompt.

- **10 additional outbound tools** (on top of Phase C1's 6):
  - `whatsapp_send_video`, `whatsapp_send_audio`,
    `whatsapp_send_voice`, `whatsapp_send_document` —
    media sends, accept `link` or `id`.
  - `whatsapp_send_location` — lat/lng with optional name +
    address (latitude / longitude range-validated via zod).
  - `whatsapp_send_contacts` — one or more vCard-style contact
    cards.
  - `whatsapp_send_interactive_buttons` — 1–3 quick-reply
    buttons with optional text / image / video / document
    header.
  - `whatsapp_send_interactive_list` — 1–10 sections × 1–10
    rows each, with optional text header.
  - `whatsapp_send_auth_template` — OTP-bearing authentication
    template; OTP length capped at 15 chars.
  - `whatsapp_send_carousel_template` — 1–10 media-card
    carousel template with optional buttons per card.
- **2 MCP resources:**
  - `whatsapp://window/{phone}` — current 24-h-window state
    for a recipient. Reads from a `WindowTracker` if one was
    wired via `BuildServerInput.windowTracker`; otherwise
    returns `isOpen: false` with a notice that no tracker is
    configured. The model can read this without spending a
    tool call.
  - `whatsapp://templates` — list of approved templates,
    cached in-process for 60 seconds to avoid hammering Meta's
    Graph API. The cache TTL is documented in the resource's
    description so the model knows reads can lag a recent
    approval by up to a minute.
- **1 MCP prompt:** `wa-template-send` — a slash-command-style
  guided walkthrough that surfaces in Claude Desktop's prompt
  picker. With no args, instructs the model to read the
  `whatsapp://templates` resource, fetch the chosen template
  via `whatsapp_get_template`, ask the user for variables, and
  call `whatsapp_send_template`. Accepts optional
  `templateName` and `recipientPhone` arguments that short-cut
  the relevant prompt steps.
- **`BuildServerInput` widening:** accepts an optional
  `windowTracker` (consumed by the window resource) and an
  optional `now` clock injection (used by the templates-cache
  unit test).
- **Server handshake now declares `resources` + `prompts`
  capabilities** in addition to `tools`.

### Tests

The MCP package now ships 94 tests:

- `test/unit/env.test.ts` (13) — env-var + CLI-flag loader.
- `test/unit/errors.test.ts` (12) — per-`WhatsAppError`
  recovery hints and `AuthenticationError` token-leak
  prevention.
- `test/contract/server.test.ts` (9) — every tool's shape
  (description, schemas, annotations) plus C1 happy paths.
- `test/contract/send-tools.test.ts` (18) — happy-path
  contract tests for every Phase C2 send tool against
  `MockWhatsAppClient` + 8 input-validation tests asserting
  that zod-rejected inputs surface as
  `{ isError: true, content: [text with validation code] }`.
- `test/contract/resources.test.ts` (6) — window resource with
  / without tracker, after `notifyInbound`; templates resource
  shape + 60-second cache hit/miss with injected clock.
- `test/contract/prompts.test.ts` (4) — `wa-template-send`
  registration shape + emitted-messages for the three argument
  combinations.
- `test/contract/public-surface.test.ts` (32) — drift detector
  asserting every documented export, every tool name, both
  resource URI schemes, and the prompt name match the v1 spec.

## [0.1.0] — 2026-05-11

### Added

First publishable release. Ships the MCP server core plus the
first 6 outbound tools, sufficient to wire Claude Desktop to a
WhatsApp WABA for simple agent-driven sends.

- **Bin `dojo-whatsapp-mcp`** — `npx -y @dojocoding/whatsapp-mcp`
  spawns an MCP server over stdio (the transport Claude Desktop,
  Cursor, and Cline use).
- **Programmatic API** — `import { WhatsAppMcpServer } from "@dojocoding/whatsapp-mcp"`
  for embedding inside a larger agent runtime (e.g. a Claude
  Agent SDK process that wires the server via
  `InMemoryTransport`).
- **6 tools, all with zod input schemas + structuredContent
  outputs:**
  - `whatsapp_send_text` — window-gated text send.
  - `whatsapp_send_image` — window-gated, accepts `link` or `id`.
  - `whatsapp_send_template` — window-exempt; the canonical way
    to re-engage a customer past the 24-hour window.
  - `whatsapp_send_reaction` — window-exempt, idempotent,
    annotated `idempotentHint: true`.
  - `whatsapp_list_templates` / `whatsapp_get_template` — read
    tools, annotated `readOnlyHint: true`. Use them to ground
    the model before calling `whatsapp_send_template`.
- **Error mapping with LLM-actionable recovery hints.** The
  SDK's typed `WhatsAppError` subclasses map to MCP tool
  responses with `isError: true` and per-subclass recovery
  hints (e.g. `WindowClosedError` → "use
  `whatsapp_send_template`"). `AuthenticationError`'s
  `structuredContent.error.message` is redacted to prevent
  token leakage into the transcript.
- **Auth via env vars** — `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID` required; `WHATSAPP_BUSINESS_ACCOUNT_ID`,
  `WHATSAPP_API_VERSION`, `WHATSAPP_APP_SECRET`, `MCP_LOG_LEVEL`
  optional. Optional CLI flag fallback (`--access-token`,
  `--phone-number-id`, etc.). Credentials NEVER accepted as
  tool-call arguments — the spec forbids it because the model
  could echo a token back in `content[].text`.
- **stdio transport, stderr-only diagnostics.** Per the spec,
  writing to stdout outside JSON-RPC frames corrupts the
  protocol — every log line goes to stderr.

Tests: 49 (13 env, 12 errors, 14 public-surface drift detector,
10 contract via in-memory MCP transport + MockWhatsAppClient).

See OpenSpec change `2026-05-10-add-mcp-server` for the full
spec.
