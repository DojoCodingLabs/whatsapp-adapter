## ADDED Requirements

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
