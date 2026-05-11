# Changelog

All notable changes to `@dojocoding/whatsapp-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0 minor versions may contain breaking changes — see
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) § Releases.

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
