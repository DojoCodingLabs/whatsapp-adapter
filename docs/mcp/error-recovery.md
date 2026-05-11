# Error recovery

This page catalogs every `isError: true` response shape the MCP
server produces, what triggered it, and what the LLM should do
next. The recovery hints are written **for the model** — they're
the actual `content[0].text` an MCP-host LLM sees.

## Response shape

Two channels:

**Model-recoverable** (recovery hint, model can self-correct):

```ts
{
  content: [{ type: "text", text: "<recovery hint>" }],
  isError: true,
  structuredContent: {
    error: {
      code: "WINDOW_CLOSED" | "TEMPLATE" | "RATE_LIMIT" | ...,
      message: "<SDK message or redacted alternative>"
    }
  }
}
```

**Protocol-level** (the framework converts to a JSON-RPC error;
the model usually can't retry — it's a programmer or transport
failure):

```jsonrpc
{
  "jsonrpc": "2.0",
  "id": ...,
  "error": { "code": -32602, "message": "..." }
}
```

Rule of thumb: anything the model could fix by re-prompting →
`isError: true`. Anything that's a bug or invalid argument →
JSON-RPC error.

## The recovery-hint catalogue

### `WINDOW_CLOSED`

**Trigger:** model called a window-gated tool (send*text,
send_image, send_video, send_audio, send_voice, send_document,
send_location, send_contacts, send_interactive*\*) against a
recipient whose 24-hour customer-service window is closed.

**Hint:**

> The 24-hour customer-service window is closed for this
> recipient. Use `whatsapp_send_template` with an approved
> template to re-engage; templates are window-exempt.

**Model action:** call `whatsapp_list_templates` (or read the
`whatsapp://templates` resource), pick an appropriate template,
call `whatsapp_get_template` to inspect variable slots, ask the
user for variable values, call `whatsapp_send_template`.

The `wa-template-send` prompt encodes this flow if the user
wants to drive it manually.

### `TEMPLATE`

**Trigger:** template send rejected by the SDK's template
validation or by Meta. Common causes: wrong language code,
parameter count mismatch, template not in `APPROVED` status,
non-existent template name.

**Hint:**

> Template send failed: `<SDK message>`. Inspect the template
> with `whatsapp_get_template` to verify the variable count,
> language code, and approval status, then retry.

**Model action:** call `whatsapp_get_template` on the template
id. Check the `language` field matches what was sent. Count the
`{{N}}` placeholders in the body / header / button components
against the `components` shape passed in. Fix and retry.

### `RATE_LIMIT`

**Trigger:** Meta rate-limited the send (HTTP 429 or a documented
rate-limit error code).

**Hint (when `retryAfterMs` is present):**

> Meta rate-limited this send (retryAfterMs=1234). Wait at least
> 1234 ms before retrying, or reduce send concurrency.

**Hint (no `retryAfterMs`):**

> Meta rate-limited this send. Wait before retrying, or reduce
> send concurrency.

**Model action:** for one-off sends, wait the documented duration
and retry. For broadcast scenarios, this is a signal that bulk
sends shouldn't go through the agent — wire the SDK's
`RateLimitedQueue` server-side instead.

### `AUTHENTICATION`

**Trigger:** Meta rejected the access token.

**Hint:**

> The access token was rejected by Meta. The server administrator
> should verify the value of `WHATSAPP_ACCESS_TOKEN`; do not echo
> or log the token contents.

**Model action:** stop attempting sends; ask the user to verify
their `claude_desktop_config.json` (or equivalent) env block.

**Privacy:** the `structuredContent.error.message` for
`AuthenticationError` is **redacted** to a fixed string:

> Meta rejected the access token. Message redacted to avoid
> leaking credentials into the MCP transcript.

This is deliberate. The SDK's raw `AuthenticationError.message`
can contain the token value in some failure paths; echoing it
into MCP transcripts would leak it into Claude's conversation
history, logs, and any saved chat exports. A unit test asserts
the token never appears in any field of the response.

### `PERMISSION`

**Trigger:** the access token is valid but lacks a required
scope. Most commonly: the model tries to read templates
(`whatsapp_list_templates` / `whatsapp_get_template`) with a
token that only has `whatsapp_business_messaging` (you also need
`whatsapp_business_management` for template reads).

**Hint:**

> The access token lacks the required scope. The token must
> include `whatsapp_business_messaging` (and
> `whatsapp_business_management` for template-registry reads).

**Model action:** stop attempting the offending operation; ask
the user to regenerate the token with the right scopes.

### `CAPABILITY`

**Trigger:** the WABA or phone number isn't capability-enabled
for the requested operation. Examples: a phone number not
enrolled for calls trying to send a call-button template, a
sandbox WABA hitting production-only features.

**Hint:**

> This WABA or phone number is not capability-enabled for the
> requested operation: `<SDK message>`.

**Model action:** pick a different tool / template, or escalate
to the user.

### `MISSING_CREDENTIALS`

**Trigger:** the SDK detected a missing credential field at
construction time. **Should never reach the model** in practice —
the bin's env-loader catches this at startup and exits with code
1 before any MCP message goes out.

**Hint:**

> The MCP server was started without complete credentials. The
> operator should restart with `WHATSAPP_ACCESS_TOKEN` and
> `WHATSAPP_PHONE_NUMBER_ID` set.

### Validation errors

**Trigger:** zod input-schema rejection. The MCP framework
intercepts before the handler runs and produces an
`isError: true` response with the zod error tree in `content[0].text`.

**Example:**

```
MCP error -32602: Input validation error: Invalid arguments for
tool whatsapp_send_location: [{ "code": "too_big", "maximum": 90,
"message": "Number must be less than or equal to 90",
"path": ["latitude"] }]
```

**Model action:** re-read the tool's `inputSchema` from
`tools/list`, fix the offending field, retry.

## What re-throws (JSON-RPC error)

Anything that isn't a `WhatsAppError` subclass:

- Programmer errors in the tool handler (assertion failures,
  unexpected SDK shape, etc.) — these surface as JSON-RPC
  `-32603 Internal Error`.
- Transport-layer failures (stdio framing corruption, JSON parse
  errors) — `-32700` / `-32600` / `-32601`.
- Tool not found — `-32602`.

None of these are model-recoverable. The model surfaces them to
the user; the operator fixes the bug or the wire.

## Drift detection

The recovery-hint string for each subclass is asserted by the
package's unit-test suite (`packages/whatsapp-mcp/test/unit/errors.test.ts`).
Any change to the hint text trips the test, so the catalogue
above and the runtime behaviour stay in lockstep.
