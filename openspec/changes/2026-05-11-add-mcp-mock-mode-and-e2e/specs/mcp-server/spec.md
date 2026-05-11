## MODIFIED Requirements

### Requirement: Configuration via environment variables

The bin (`dojo-whatsapp-mcp`) SHALL load credentials and runtime
configuration from environment variables, with optional CLI flag
fallback:

| Env var | CLI flag | Required |
| ------- | -------- | -------- |
| `WHATSAPP_ACCESS_TOKEN` | `--access-token` | yes |
| `WHATSAPP_PHONE_NUMBER_ID` | `--phone-number-id` | yes |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `--business-account-id` | no |
| `WHATSAPP_API_VERSION` | `--api-version` | no |
| `WHATSAPP_APP_SECRET` | `--app-secret` | no (reserved) |
| `WHATSAPP_MODE` | `--mode` | no (default `"real"`; accepts `"real"` \| `"mock"`) |
| `MCP_LOG_LEVEL` | `--log-level` | no (default `info`) |

When a required value is missing, the bin SHALL exit with code
`1` and write a clear human-readable message to `stderr` listing
the missing field(s).

When `WHATSAPP_MODE=mock` is set, the bin SHALL use
`MockWhatsAppClient` (via the SDK's `pickWhatsAppClient` factory
with `forceMock: true`) instead of the real `WhatsAppClient`,
and SHALL write a line `MOCK MODE — preview only; no Meta calls`
to `stderr` at startup so operators can confirm the mode they
booted into.

When `WHATSAPP_MODE` is set to an unrecognised value (anything
other than `"real"` or `"mock"`), the bin SHALL normalise to
`"real"` and write a warning to `stderr`.

Credentials SHALL NOT be acceptable as tool-call arguments. The
input schemas of every tool SHALL NOT contain an
`accessToken` / `phoneNumberId` field.

#### Scenario: Missing required env var halts startup

- **WHEN** the bin is spawned with `WHATSAPP_ACCESS_TOKEN` unset
  and no `--access-token` flag
- **THEN** the process writes a message to stderr containing
  `WHATSAPP_ACCESS_TOKEN` and a hint about how to set it
- **AND** the process exits with code `1` before any MCP message
  is sent

#### Scenario: CLI flag overrides env var

- **WHEN** the bin is spawned with both `WHATSAPP_ACCESS_TOKEN=env`
  and `--access-token=cli`
- **THEN** the resulting `WhatsAppClient` is constructed with
  the value `"cli"`

#### Scenario: WHATSAPP_MODE=mock swaps in MockWhatsAppClient

- **WHEN** the bin is spawned with `WHATSAPP_MODE=mock` and the
  required credentials supplied (any non-empty strings)
- **THEN** `pickWhatsAppClient` returns a `MockWhatsAppClient`
  instance bound to those credentials
- **AND** stderr contains the line `MOCK MODE — preview only; no Meta calls`
- **AND** subsequent tool calls return wamids matching
  `/^wamid\.mock-\d+$/` (the mock's deterministic counter)

#### Scenario: WHATSAPP_MODE with unrecognised value falls back to real

- **WHEN** the bin is spawned with `WHATSAPP_MODE=preview` (not
  a recognised value)
- **THEN** the resulting client is a real `WhatsAppClient` (not
  a mock)
- **AND** stderr contains a warning line naming the unrecognised
  value

## ADDED Requirements

### Requirement: Spawn-and-stdio runtime contract

The published `dojo-whatsapp-mcp` bin SHALL satisfy a set of
runtime invariants that the in-process contract tests cannot
exercise. These invariants are asserted by an end-to-end test
suite gated on `WHATSAPP_MCP_E2E=1`:

- The built `dist/cli.js` SHALL have a valid shebang
  (`#!/usr/bin/env node`) such that the file can be spawned
  directly by an MCP host.
- The built `dist/cli.js` SHALL have the executable bit set
  (`chmod +x`) on Unix-like systems.
- The bin SHALL communicate over stdio using newline-delimited
  JSON-RPC frames (one frame per line on stdout; no
  `Content-Length` framing).
- All diagnostic output (including the mock-mode banner, startup
  log lines, and any error messages) SHALL be written to
  `stderr`. **Stdout SHALL contain only valid JSON-RPC frames.**
  Any non-JSON line on stdout corrupts the host parser and is a
  protocol-level bug.
- The bin SHALL exit cleanly (code `0`) when the parent closes
  its stdin.

#### Scenario: Stdout contains only valid JSON-RPC frames

- **WHEN** the E2E suite spawns the bin, completes the
  `initialize` handshake, calls `tools/list`, and invokes
  `tools/call whatsapp_send_text` against a mock-mode bin
- **THEN** every non-empty line on stdout SHALL parse as a
  valid JSON-RPC envelope (object with `jsonrpc: "2.0"` and
  either `result`, `error`, or `method`)
- **AND** no line on stdout SHALL fail `JSON.parse`

#### Scenario: Initialize → tools/list → tools/call round trip

- **WHEN** the E2E suite drives a `tools/call whatsapp_send_text`
  through the spawned bin in mock mode
- **THEN** the response's `structuredContent.messageId` matches
  `/^wamid\.mock-\d+$/`
- **AND** `structuredContent.recipientPhone` equals the `to`
  argument from the call
- **AND** the response is delivered within 5 seconds of the
  request being written to stdin

#### Scenario: Bin exits cleanly on stdin close

- **WHEN** the parent process closes the bin's stdin
- **THEN** the bin terminates within 3 seconds
- **AND** the exit code SHALL be `0`

### Requirement: Mock-mode preview is a public developer feature

The `WHATSAPP_MODE=mock` env var SHALL be documented as a
public-facing developer feature, not solely a testing
affordance. Documentation in `docs/mcp/auth.md` and
`docs/mcp/quickstart.md` SHALL show the canonical
`claude_desktop_config.json` snippet for enabling mock mode
so developers can wire up Claude Desktop without a real WABA
during setup-verification, prompt-engineering iteration, and
downstream consumer CI workflows.

The mock mode SHALL NOT change the registered tool surface,
resource URIs, or prompt names — the agent sees an identical
MCP server; only the upstream send target changes from Meta to
the in-memory `MockWhatsAppClient`.

#### Scenario: Tool surface is identical in mock and real modes

- **WHEN** an MCP client lists tools against a bin started with
  `WHATSAPP_MODE=mock`
- **THEN** the returned tool count is exactly 16
- **AND** the returned tool names match the v1 spec exactly
- **AND** the surface is byte-identical to a bin started without
  the env var (modulo non-deterministic fields like
  `_meta.requestId`)
