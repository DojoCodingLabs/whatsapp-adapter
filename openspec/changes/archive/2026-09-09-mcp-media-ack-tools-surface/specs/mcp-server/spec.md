## MODIFIED Requirements

### Requirement: Outbound tools surface

The MCP server SHALL register exactly the following 19 tools.
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
| `whatsapp_send_reaction` | `client.sendReaction` | yes (Meta exempts only approved templates) | `idempotentHint: true` |
| `whatsapp_list_templates` | `client.listTemplates` | n/a | `readOnlyHint: true` |
| `whatsapp_get_template` | `client.getTemplate` | n/a | `readOnlyHint: true` |
| `whatsapp_mark_as_read` | `client.markAsRead` | no (acks are window-independent) | `idempotentHint: true` |
| `whatsapp_upload_media_from_url` | `client.uploadMedia` (after a server-side `fetch` of `sourceUrl`) | n/a | `idempotentHint: false` |
| `whatsapp_get_media_info` | `client.downloadMedia` (metadata only) | n/a | `readOnlyHint: true`, `idempotentHint: true` |

Each tool SHALL declare:

- A `zod` `inputSchema` matching the SDK's underlying method
  signature (recipient phone numbers as `string`, language
  codes as ISO `xx_XX`, etc.).
- An `outputSchema` of the form `z.object({ messageId, recipientPhone, wabaPhoneNumberId })`
  for every send tool. Read tools (`list_templates`,
  `get_template`, `get_media_info`) and the ack / upload tools
  (`mark_as_read`, `upload_media_from_url`) declare their own
  output shapes mirroring the wrapped SDK method
  (`{ success, messageId, typing }`, `{ mediaId, mimeType, bytes }`,
  `{ id, mimeType, sha256, fileSize }`).
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
- **THEN** the response contains exactly 19 tool entries
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

#### Scenario: Reaction outside the window is gated

- **WHEN** the LLM invokes `whatsapp_send_reaction` for a recipient
  whose 24-hour window is closed
- **THEN** the tool response has `isError: true`
- **AND** `structuredContent.error.code === "WINDOW_CLOSED"`

#### Scenario: mark_as_read is window-independent

- **WHEN** the LLM invokes `whatsapp_mark_as_read` with a wamid for a
  recipient with no recorded inbound (window closed)
- **THEN** the tool succeeds
- **AND** `structuredContent` equals `{ success: true, messageId, typing }`

#### Scenario: get_media_info never exposes the pre-signed URL

- **WHEN** the LLM invokes `whatsapp_get_media_info` with a known media id
- **THEN** `structuredContent` contains `id`, `mimeType`, `sha256`, `fileSize`
- **AND** neither `structuredContent` nor `content[].text` contains the
  bearer-authenticated download URL or the media bytes

#### Scenario: upload_media_from_url refuses non-public targets before fetching

The server fetches `sourceUrl` itself, so the URL is a
server-side-request-forgery vector. Before any network I/O the tool
SHALL reject, with `isError: true` and
`structuredContent.error.code === "source_url_rejected"`, any
`sourceUrl` whose scheme is not `https:`, that embeds credentials,
whose hostname is `localhost` / `*.localhost` / `*.local`, or whose
hostname is a literal loopback, unspecified, link-local, RFC 1918,
or shared-address-space (100.64/10) IPv4 address — including the
IPv4-mapped IPv6 spellings — or an IPv6 loopback / link-local /
unique-local literal. The fetch SHALL be issued with
`redirect: "error"` so a 3xx cannot bounce to a refused host.

- **WHEN** the LLM invokes `whatsapp_upload_media_from_url` with
  `sourceUrl: "https://169.254.169.254/latest/meta-data/"`
- **THEN** `fetch` is not called
- **AND** the response has `isError: true` and
  `structuredContent.error.code === "source_url_rejected"`

#### Scenario: upload_media_from_url surfaces a failed source fetch without touching Meta

- **WHEN** the source URL responds non-2xx, or `fetch` rejects (e.g. a
  refused redirect)
- **THEN** the response has `isError: true` and
  `structuredContent.error.code === "source_fetch_failed"`
- **AND** `client.uploadMedia` is not called

#### Scenario: upload_media_from_url returns a reusable media id

- **WHEN** the source URL responds 2xx with a body within Meta's size
  ceiling for `mimeType`
- **THEN** the bytes are passed to `client.uploadMedia`
- **AND** `structuredContent` equals `{ mediaId, mimeType, bytes }`
- **AND** an oversize body surfaces the SDK's `CapabilityError` as
  `isError` with `structuredContent.error.code === "CAPABILITY"`

### Requirement: Embedded toolset API

The package SHALL export a `createWhatsAppToolset(input)`
factory that returns a flat, callable `WhatsAppToolset` exposing
the same 19 tools, 2 resources, and 1 prompt as the stdio
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
