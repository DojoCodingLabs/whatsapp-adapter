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

### `UNDELIVERABLE`

**Trigger:** Meta code `131026` — the recipient is not on
WhatsApp, runs an outdated client, or has not accepted the current
Terms of Service. Distinct from `WINDOW_CLOSED`.

**Hint:**

> The recipient is unreachable on WhatsApp (not registered,
> outdated client, or has not accepted current Terms of Service).
> This is NOT the same as a closed 24-hour window — sending a
> template will not help. Do not retry; surface the failure to a
> human operator so they can reach the customer through another
> channel.

### `OPT_OUT`

**Trigger:** the configured `OptInRegistry` reports the recipient
as opted out (pre-flight, no HTTP), **or** Meta code `131050` —
the recipient asked WhatsApp to stop marketing messages from this
business.

**Hint:**

> The recipient has opted out of MARKETING. [Meta reported this
>
> > opt-out (error 131050), so it is authoritative — record it in
> > the consent ledger and do not retry marketing sends to this
> > recipient.] Record explicit consent via your opt-in flow /
> > consent ledger before re-sending. Templates of a different
> > category may still be allowed if the opt-out is category-scoped.

The bracketed sentence appears only when `metaCode === 131050`.
The recipient is redacted to its last four digits in every field.

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

**Long-window variants** (same class, different hint):

- `metaCode === 131049` — per-recipient marketing cap. Hint tells
  the model not to retry that recipient for 24 h and to prefer a
  UTILITY template when the content is transactional.
- `metaCode === 131064` — messaging limit reduced after
  template-classification violations. Hint is operator-targeted
  (review categories in WhatsApp Manager); retrying is pointless.

### `ACCOUNT_RESTRICTED`

**Trigger:** Meta integrity enforcement — codes `368` (temporarily
blocked), `130497` (country restriction), `131031` (account
locked).

**Hint:**

> Meta has restricted or locked this WhatsApp Business Account
> (integrity enforcement). No send will succeed until the operator
> resolves it in WhatsApp Manager / Business Support Home. Stop
> attempting sends and surface this to a human.

**Model action:** stop the whole task, not just this send.

### `TRANSIENT`

**Trigger:** Meta returned `408` / `5xx` on every attempt of the
SDK's retry budget.

**Hint:**

> Meta's API was unavailable (HTTP 503) and the SDK exhausted its
> retries. The message may or may not have been delivered — check
> the conversation before re-sending to avoid a duplicate. Retry
> once after a short pause.

**Model action:** read the thread (`whatsapp://window/...` or the
consumer's inbox) before re-sending. A 5xx after Meta accepted the
message is a real possibility.

### `NETWORK`

**Trigger:** `fetch` never got a response (DNS / TCP / TLS).

**Hint:**

> The server could not reach graph.facebook.com (DNS / TCP / TLS
> failure). The request never reached Meta, so it is safe to retry
> once connectivity is restored; if it persists, the operator
> should check outbound network access.

### `ABORTED`

**Trigger:** the tool call's `AbortSignal` fired (host cancelled
the request).

**Hint:**

> The request was cancelled before completing. Retry if the
> cancellation was not intended.

### `MEDIA_EXPIRED`

**Trigger:** Meta's media CDN answered `401` / `403` / `404` / `410`
on a bytes fetch — the pre-signed URL has outlived its ~5-minute TTL.

**Hint:**

> Meta's media download URL for media `<id>` was rejected (HTTP 404)
> — these URLs expire about 5 minutes after issue. Do not retry the
> same URL; call whatsapp_get_media_info again (or have the server
> call downloadMedia) to obtain a fresh one.

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
