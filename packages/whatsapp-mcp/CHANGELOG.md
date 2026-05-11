# Changelog

All notable changes to `@dojocoding/whatsapp-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0 minor versions may contain breaking changes — see
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) § Releases.

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
