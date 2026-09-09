## MODIFIED Requirements

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
| `UndeliverableError` | "The recipient is unreachable on WhatsApp … sending a template will not help. Do not retry; surface the failure to a human operator." |
| `OptOutError` | "The recipient has opted out [of `<category>`]. … Record explicit consent … before re-sending." When `metaCode === 131050` the hint SHALL additionally state that Meta reported the opt-out and it is authoritative. |
| `TemplateError` | "Template send failed [(Meta error `<metaCode>`)]: … Inspect the template with `whatsapp_get_template` to verify the variable count, language code, and approval status." |
| `RateLimitError` | "Meta rate-limited this send. Wait `<retryAfterMs>` ms and retry, or reduce send concurrency." When `metaCode === 131049` the hint SHALL say not to retry that recipient for 24 hours; when `metaCode === 131064` the hint SHALL be operator-targeted (review template categories) and say retrying will not help. |
| `AccountRestrictedError` | "Meta has restricted or locked this WhatsApp Business Account … Stop attempting sends and surface this to a human." |
| `TransientError` | "Meta's API was unavailable [(HTTP `<httpStatus>`)] and the SDK exhausted its retries. The message may or may not have been delivered — check the conversation before re-sending to avoid a duplicate." |
| `NetworkError` | "The server could not reach graph.facebook.com … The request never reached Meta, so it is safe to retry once connectivity is restored." |
| `RequestAbortedError` | "The request was cancelled before completing. Retry if the cancellation was not intended." |
| `MediaExpiredError` | "Meta's media download URL [for media `<mediaId>`] was rejected (HTTP `<httpStatus>`) — these URLs expire about 5 minutes after issue. Do not retry the same URL; call whatsapp_get_media_info again (or have the server call downloadMedia) to obtain a fresh one." |
| `AuthenticationError` | "The access token was rejected by Meta. The server administrator should verify `WHATSAPP_ACCESS_TOKEN`." (The token itself SHALL NOT appear in the hint.) |
| `PermissionError` | "The access token lacks the required scope. The token must include `whatsapp_business_messaging`." |
| `CapabilityError` | "This WABA or phone number is not capability-enabled for this operation." |
| `MissingCredentialsError` | "The MCP server was started without complete credentials. …" |

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

#### Scenario: AccountRestrictedError tells the model to stop

- **WHEN** the SDK throws `new AccountRestrictedError("blocked", { metaCode: 368 })`
- **THEN** `structuredContent.error.code === "ACCOUNT_RESTRICTED"`
- **AND** `content[0].text` contains "Stop attempting sends"

#### Scenario: TransientError warns about possible duplicate delivery

- **WHEN** the SDK throws `new TransientError("x", { httpStatus: 503, attempts: 4 })`
- **THEN** `structuredContent.error.code === "TRANSIENT"`
- **AND** `content[0].text` contains "HTTP 503" and "duplicate"

#### Scenario: Per-user marketing cap gets a 24-hour hint

- **WHEN** the SDK throws `new RateLimitError("x", { metaCode: 131049 })`
- **THEN** `content[0].text` contains "131049" and "24 hours"

#### Scenario: Meta-reported opt-out is marked authoritative

- **WHEN** the SDK throws `new OptOutError("+5210000000001", "MARKETING", { metaCode: 131050 })`
- **THEN** `content[0].text` contains "131050" and "authoritative"
- **AND** the full recipient number appears nowhere in the response

#### Scenario: MediaExpiredError tells the model to fetch a fresh URL

- **WHEN** the SDK throws `new MediaExpiredError({ httpStatus: 404, mediaId: "M1" })`
- **THEN** `structuredContent.error.code === "MEDIA_EXPIRED"`
- **AND** `content[0].text` contains "M1", "HTTP 404", "Do not retry the same URL" and "whatsapp_get_media_info"
