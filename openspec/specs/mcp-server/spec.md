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
| `MCP_LOG_LEVEL` | `--log-level` | no (default `info`) |

When a required value is missing, the bin SHALL exit with code
`1` and write a clear human-readable message to `stderr` listing
the missing field(s).

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

