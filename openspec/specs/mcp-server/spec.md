# mcp-server Specification

## Purpose
TBD - created by archiving change 2026-05-10-add-mcp-server. Update Purpose after archive.
## Requirements
### Requirement: MCP server package and bin

The repository SHALL publish a sibling npm package
`@dojocoding/whatsapp-mcp` adjacent to
`@dojocoding/whatsapp-sdk`, implemented under
`packages/whatsapp-mcp/`. The package SHALL:

- Expose `WhatsAppMcpServer` and `buildServer` as named exports
  from the default subpath.
- Declare `bin: { "dojo-whatsapp-mcp": "./dist/cli.js" }`.
- Build a CommonJS `dist/cli.js` with the shebang
  `#!/usr/bin/env node` and the `+x` executable bit.
- Declare runtime dependencies on `@dojocoding/whatsapp-sdk`,
  `@modelcontextprotocol/sdk ^1.29`, `zod ^3.25`, and
  `zod-to-json-schema ^3.24`.
- Publish to npm with provenance (`publishConfig.provenance: true`)
  via the same GitHub Actions OIDC flow used by
  `@dojocoding/whatsapp-sdk`.

#### Scenario: Bin is executable after publish

- **WHEN** a user runs `npx -y @dojocoding/whatsapp-mcp` with
  the required env vars set
- **THEN** the binary spawns and begins serving the MCP protocol
  over stdio (JSON-RPC framing on stdin/stdout)
- **AND** server diagnostics appear on stderr, not stdout
- **AND** the process does not exit until the parent closes
  stdin

#### Scenario: Importable as a library

- **WHEN** a consumer imports `WhatsAppMcpServer` from
  `@dojocoding/whatsapp-mcp` and instantiates it with a
  pre-constructed `WhatsAppClient`
- **THEN** the consumer can call `.connect(transport)` with any
  `@modelcontextprotocol/sdk` transport and the server registers
  the documented tool/resource/prompt surface

### Requirement: Outbound tools surface

The MCP server SHALL register exactly the following 16 tools.
Tool names SHALL be `snake_case` and prefixed `whatsapp_`.

| Tool | Wraps SDK method | Window-gated | Annotations |
| ---- | ---------------- | ------------ | ----------- |
| `whatsapp_send_text` | `client.sendText` | yes | — |
| `whatsapp_send_image` | `client.sendImage` | yes | — |
| `whatsapp_send_video` | `client.sendVideo` | yes | — |
| `whatsapp_send_audio` | `client.sendAudio` | yes | — |
| `whatsapp_send_voice` | `client.sendVoice` | yes | — |
| `whatsapp_send_document` | `client.sendDocument` | yes | — |
| `whatsapp_send_location` | `client.sendLocation` | yes | — |
| `whatsapp_send_contacts` | `client.sendContacts` | yes | — |
| `whatsapp_send_interactive_buttons` | `client.sendInteractive` (button shape) | yes | — |
| `whatsapp_send_interactive_list` | `client.sendInteractive` (list shape) | yes | — |
| `whatsapp_send_template` | `client.sendTemplate` | no (exempt) | — |
| `whatsapp_send_auth_template` | `client.sendAuthTemplate` | no (exempt) | — |
| `whatsapp_send_carousel_template` | `client.sendCarouselTemplate` | no (exempt) | — |
| `whatsapp_send_reaction` | `client.sendReaction` | no (exempt) | `idempotentHint: true` |
| `whatsapp_list_templates` | `client.listTemplates` | n/a | `readOnlyHint: true` |
| `whatsapp_get_template` | `client.getTemplate` | n/a | `readOnlyHint: true` |

Each tool SHALL declare:

- A `zod` `inputSchema` matching the SDK's underlying method
  signature (recipient phone numbers as `string`, language
  codes as ISO `xx_XX`, etc.).
- An `outputSchema` of the form `z.object({ messageId, recipientPhone, wabaPhoneNumberId })`
  for every send tool. Read tools (`list_templates`,
  `get_template`) declare their own output shapes mirroring
  `client.listTemplates` / `client.getTemplate`.
- A human-readable `description` containing at least: the verb,
  the gating rule, and a one-line recovery hint pointing at the
  most likely error.

Tool handlers SHALL return:

- On success: `{ content: [{ type: "text", text: <human summary> }], structuredContent: <matches outputSchema> }`.
- On `WhatsAppError` (or any subclass thrown by the SDK):
  `{ content: [{ type: "text", text: <recovery hint> }], isError: true, structuredContent: { error: { code, message } } }`.
- On any other thrown error: re-throw, so the MCP framework
  surfaces a JSON-RPC error.

#### Scenario: All tools register at startup

- **WHEN** an MCP client connects to a freshly-started
  `WhatsAppMcpServer` and issues `tools/list`
- **THEN** the response contains exactly 16 tool entries
- **AND** every entry's `name` matches the table above
- **AND** every entry includes a `description`, `inputSchema`,
  `outputSchema`, and (if applicable) `annotations`

#### Scenario: Window-gated tool surfaces WindowClosedError as isError

- **WHEN** the LLM invokes `whatsapp_send_text` with a recipient
  whose 24-hour customer-service window is closed
- **THEN** the tool response has `isError: true`
- **AND** `content[0].text` contains a recovery hint instructing
  the LLM to use `whatsapp_send_template` with an approved
  template
- **AND** `structuredContent.error.code === "WINDOW_CLOSED"`

#### Scenario: Window-exempt tool succeeds while window is closed

- **WHEN** the LLM invokes `whatsapp_send_template` with a
  recipient whose 24-hour window is closed and a valid approved
  template
- **THEN** the SDK does not throw `WindowClosedError`
- **AND** the tool response contains the new `messageId` in
  `structuredContent`

#### Scenario: Read-only tools are annotated

- **WHEN** a client introspects `whatsapp_list_templates` or
  `whatsapp_get_template`
- **THEN** `annotations.readOnlyHint === true`
- **AND** invoking them never produces a write side-effect

### Requirement: Resources for window state and template list

The MCP server SHALL register the following two resource URI
templates:

- `whatsapp://window/{phone}` — current 24-hour window state for
  a specific recipient.
- `whatsapp://templates` — list of approved templates with
  metadata.

#### Scenario: Window resource returns isOpen for a known phone

- **WHEN** the client reads `whatsapp://window/+5210000000001`
  and inbound messages from that recipient have populated the
  `WindowTracker`
- **THEN** the resource payload is JSON with shape
  `{ phone: string, isOpen: boolean }`
- **AND** `isOpen` matches what `WindowTracker.isWindowOpen` would
  return synchronously

#### Scenario: Templates resource caches for 60 seconds

- **WHEN** the client reads `whatsapp://templates` twice within
  60 seconds
- **THEN** the second read SHALL NOT issue a new Meta Graph API
  request
- **AND** both reads return the same cached payload

### Requirement: Prompt `wa-template-send`

The MCP server SHALL register a prompt named `wa-template-send`
with optional arguments `templateName` (string) and
`recipientPhone` (string). The prompt SHALL emit a guided
`messages[]` instructing the model to:

1. Read `whatsapp://templates` if `templateName` was not given.
2. Read the chosen template's schema via
   `whatsapp_get_template`.
3. Ask the user for variable values.
4. Invoke `whatsapp_send_template`.

#### Scenario: Prompt surfaces in prompts/list

- **WHEN** a client issues `prompts/list`
- **THEN** the response contains an entry with `name: "wa-template-send"`
- **AND** the entry includes the optional `arguments` declaration

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

### Requirement: stdio transport with stderr-only logging

The bin SHALL connect via
`@modelcontextprotocol/sdk/server/stdio.js`
`StdioServerTransport`. All diagnostic output SHALL go to
`process.stderr` (never `process.stdout`) so the JSON-RPC
framing on stdout is not corrupted.

#### Scenario: Diagnostic logging does not corrupt JSON-RPC framing

- **WHEN** the bin emits an `info`-level log line during a
  request/response round trip
- **THEN** the log line appears on stderr
- **AND** the stdout stream contains only well-formed JSON-RPC
  messages (one per line, parseable by the MCP client)

### Requirement: Error mapping with LLM-actionable recovery hints

Tool handlers SHALL catch every `WhatsAppError` (or subclass)
thrown by the SDK and return an MCP tool response that:

- Sets `isError: true`.
- Populates `content[0].text` with a recovery hint specific to
  the error subclass (table below).
- Populates `structuredContent.error` with `{ code, message }`
  where `code` is the SDK's discriminator (e.g.
  `"WINDOW_CLOSED"`).

The recovery hints by subclass:

| Subclass | Recovery hint (used as `content[0].text`) |
| -------- | ----------------------------------------- |
| `WindowClosedError` | "The 24-hour customer-service window is closed for this recipient. Use `whatsapp_send_template` with an approved template." |
| `TemplateError` | "Template send failed. Inspect the template with `whatsapp_get_template` to verify the variable count, language code, and approval status." |
| `RateLimitError` | "Meta rate-limited this send. Wait `<retryAfterMs>` ms and retry, or reduce send concurrency." |
| `AuthenticationError` | "The access token was rejected by Meta. The server administrator should verify `WHATSAPP_ACCESS_TOKEN`." (The token itself SHALL NOT appear in the hint.) |
| `PermissionError` | "The access token lacks the required scope. The token must include `whatsapp_business_messaging`." |
| `CapabilityError` | "This WABA or phone number is not capability-enabled for this operation." |

Errors not extending `WhatsAppError` SHALL be re-thrown so the
MCP framework converts them to a JSON-RPC protocol error.

#### Scenario: WindowClosedError yields recovery hint

- **WHEN** the SDK throws `new WindowClosedError(...)` inside a
  send-tool handler
- **THEN** the tool response has `isError: true`
- **AND** `content[0].text` matches the `WindowClosedError` row
  above verbatim (modulo recipient-specific substitution)
- **AND** `structuredContent.error.code === "WINDOW_CLOSED"`

#### Scenario: AuthenticationError hint does not leak the token

- **WHEN** the SDK throws `new AuthenticationError(...)` inside
  any send-tool handler
- **THEN** the resulting `content[0].text` SHALL NOT contain the
  value of `WHATSAPP_ACCESS_TOKEN`
- **AND** the resulting `structuredContent.error.message` SHALL
  NOT contain that value

### Requirement: One server instance per WABA-phone pair

The MCP server's `buildServer({ client })` SHALL accept exactly
one `WhatsAppClient` instance per process. Multi-WABA deployments
SHALL be realised by spawning multiple processes, each with its
own env-var-loaded credentials, matching the SDK's
"one library instance per WABA-phone pair" invariant.

The MCP server SHALL NOT expose any tool, resource, or prompt
that switches credentials at runtime.

#### Scenario: No tool accepts credentials

- **WHEN** the registered tool schemas are inspected
- **THEN** no tool's `inputSchema` contains a field named
  `accessToken`, `phoneNumberId`, `appSecret`,
  `businessAccountId`, or any other authentication value

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

### Requirement: Embedded toolset API

The package SHALL export a `createWhatsAppToolset(input)`
factory that returns a flat, callable `WhatsAppToolset` exposing
the same 16 tools, 2 resources, and 1 prompt as the stdio
`WhatsAppMcpServer`, without instantiating an MCP `Server` or
binding to a transport.

The factory's input SHALL accept:

- `client: WhatsAppLikeClient` (required) — the SDK client used
  for outbound sends.
- `windowTracker?: WindowTracker` (optional) — forwarded to the
  window resource for `isWindowOpen` queries.
- `logger?: McpLogger` (optional) — structured logger; defaults
  to a no-op.

The returned `WhatsAppToolset` SHALL expose:

- `tools: ReadonlyArray<ToolDefinition>` — the 16 tool
  definitions, in a stable order.
- `resources: ReadonlyArray<ResourceDefinition>` — the 2
  resource definitions.
- `prompts: ReadonlyArray<PromptDefinition>` — the 1 prompt
  definition.
- `dispatch(name, args, ctx?): Promise<CallToolResult>` —
  invokes the named tool; performs schema validation, handler
  execution, and SDK→MCP error mapping using the same
  `mapSdkError` / `withErrorMapping` helpers as the stdio server.
- `readResource(uri): Promise<ReadResourceResult>` — invokes
  the resource reader matching `uri`.
- `renderPrompt(name, args?): Promise<GetPromptResult>` —
  invokes the named prompt's renderer.

Credentials SHALL NOT be acceptable as `dispatch` arguments.
The input schemas of every tool SHALL NOT contain an
`accessToken` / `phoneNumberId` / `appSecret` /
`businessAccountId` field. This invariant is enforced by the
existing public-surface drift detector.

#### Scenario: Embedded toolset dispatches a happy-path send

- **WHEN** `createWhatsAppToolset({ client })` is constructed with a
  mock client and `dispatch("whatsapp_send_text", { to, body })` is
  called
- **THEN** the result SHALL be `{ content: [...], structuredContent: { messageId: "wamid.mock-1" }, isError: false }`
  with the same shape the stdio server returns for the same input

#### Scenario: Embedded toolset surfaces a typed SDK error

- **WHEN** the underlying client throws `WindowClosedError` on a
  `whatsapp_send_text` dispatch
- **THEN** the result SHALL be `{ isError: true, structuredContent: { error: { code: "window_closed", message, recoveryHint } } }`
  with the same `recoveryHint` text the stdio server produces

#### Scenario: Embedded toolset rejects unknown tool names

- **WHEN** `dispatch("nonexistent_tool", {})` is called
- **THEN** the result SHALL be `{ isError: true, structuredContent: { error: { code: "unknown_tool", message: <names "nonexistent_tool">, recoveryHint } } }`
- **AND** no underlying client method SHALL be invoked

#### Scenario: Embedded toolset rejects invalid args

- **WHEN** `dispatch("whatsapp_send_text", { to: 123 })` is called
  with `to` of the wrong type
- **THEN** the result SHALL be `{ isError: true, structuredContent: { error: { code: "invalid_args", message, recoveryHint } } }`
- **AND** no underlying client method SHALL be invoked

#### Scenario: Embedded toolset reads the window resource

- **WHEN** `readResource("whatsapp://window/+5210000000001")` is
  called and the window tracker reports the window closed
- **THEN** the result SHALL include `contents: [{ uri, mimeType: "application/json", text }]` where `JSON.parse(text).isOpen === false`

### Requirement: Embedded-toolset / server surface parity

The package SHALL maintain byte-identical parity between
`createWhatsAppToolset(...)` and `WhatsAppMcpServer`:

- The set of tool names exposed by both paths SHALL be
  identical.
- The set of resource URIs exposed by both paths SHALL be
  identical.
- The set of prompt names exposed by both paths SHALL be
  identical.
- The JSON-Schema serialisation of each tool's input schema
  SHALL be identical between paths.

The parity invariant SHALL be enforced by a contract test that
runs on every PR. A renaming or addition to one path without
the other is a defect.

#### Scenario: Adding a tool to the toolset without the server fails CI

- **WHEN** a developer adds a 17th tool to `createWhatsAppToolset`
  but does NOT register it on `WhatsAppMcpServer`
- **THEN** the parity contract test SHALL fail with a diff naming
  the missing tool

#### Scenario: Renaming a tool in one path without the other fails CI

- **WHEN** a developer renames `whatsapp_send_text` to
  `whatsapp_text` in `WhatsAppMcpServer` but leaves the toolset
  unchanged
- **THEN** the parity contract test SHALL fail with a diff
  showing the divergent names

