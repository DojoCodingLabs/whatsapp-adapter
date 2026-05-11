# Resources

The MCP server registers two resources. Resources let the LLM
**read state** without spending a tool call — Claude pulls them
into context as it sees fit.

## `whatsapp://window/{phone}` — 24-hour window state

Returns the current 24-hour customer-service window state for a
recipient. The URI path component is the recipient phone in
E.164 format (URL-encode the `+` as `%2B` if your client doesn't
do it for you; Claude Desktop handles this).

### Shape

```json
{
  "phone": "+5210000000001",
  "isOpen": true
}
```

If the MCP server was started without a `WindowTracker` (the
default for `npx -y @dojocoding/whatsapp-mcp` standalone), the
shape is:

```json
{
  "phone": "+5210000000001",
  "isOpen": false,
  "notice": "No WindowTracker was wired to this MCP server. Reads are always isOpen: false; configure a tracker with Storage-backed state for accurate readings."
}
```

### Wiring a tracker

For the resource to return useful data, the SDK's `WindowTracker`
needs to be populated. The tracker is populated by inbound
webhooks via:

```ts
receiver.on("message", (e) => tracker.notifyInbound(e.from));
```

There are three ways to make the MCP server see this state:

**1. Embed the MCP server in-process.** Use
`new WhatsAppMcpServer({ client, wabaPhoneNumberId, windowTracker })`
inside the same process that runs your `WebhookReceiver`. The
window resource reads from the same in-memory tracker.

This is the **Claude Agent SDK pattern** — see
[`docs/cookbook/mcp/claude-agent-sdk.md`](../cookbook/mcp/claude-agent-sdk.md).

**2. Use a shared Storage backend.** Spawn the MCP server via
`npx` and have it construct a `WindowTracker` backed by Redis or
Postgres. The same backend is read/written by your separate
webhook receiver server. The MCP server resource picks up state
populated by the receiver.

In v1 this requires a small custom bin (the default `npx` bin
constructs the SDK without a `WindowTracker`). The pattern is
documented in
[`docs/cookbook/hybrid/agent-handoff-loop.md`](../cookbook/hybrid/agent-handoff-loop.md);
a `--storage-redis-url` flag for the default bin is on the
roadmap for v1.x.

**3. Accept the limitation.** For purely outbound use cases
(transactional sends, marketing broadcasts), the window state
doesn't matter — use `whatsapp_send_template` exclusively, which
is window-exempt.

### Caveats

- **In-memory tracker = per-process.** If you embed the MCP
  server in-process alongside your webhook receiver, restarts
  wipe the tracker's state. Use Redis or Postgres-backed
  `Storage` for persistence across restarts.
- **`isOpen: true` is not a guarantee Meta accepts the send.**
  The window check is the SDK's pre-flight optimisation; Meta
  may still reject for unrelated reasons (template-only number,
  rate limit, etc.).

## `whatsapp://templates` — approved-template list

Returns the list of approved templates for the bound WABA.
**Cached in-process for 60 seconds.**

### Shape

```json
{
  "data": [
    {
      "id": "1234567890",
      "name": "hello_world",
      "language": "en_US",
      "category": "UTILITY",
      "status": "APPROVED"
    },
    ...
  ],
  "cachedAt": "2026-05-11T08:00:00.000Z",
  "cacheTtlMs": 60000
}
```

Each entry mirrors `TemplateDefinition` from the SDK (minus the
`components` array — that ships with `whatsapp_get_template`).

### Why cached?

Templates rarely change at sub-minute granularity. Without a
cache, every read hits Meta's Graph API — wasteful and prone to
rate-limiting when the model decides to "double-check" before
each `whatsapp_send_template` call.

### Cache TTL

`60_000 ms` (60 seconds). Exported as the `TEMPLATES_CACHE_TTL_MS`
constant if you need to reference it.

**Consequence:** a template you just approved in Meta's UI may
not appear until the cache expires. Documented in the resource's
description so the model knows. For development, restart the MCP
server to force a fresh read.

### `whatsapp_list_templates` vs the resource

Same data, different access pattern:

|                        | Resource                                             | Tool                                                 |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| Triggered by           | model autonomously, "I want to see what's available" | model explicitly, "list templates"                   |
| Costs a tool call      | no                                                   | yes                                                  |
| Filtering / pagination | no                                                   | yes (`status`, `category`, `name`, `limit`, cursors) |
| Cached                 | yes (60s)                                            | no                                                   |

For just-in-time grounding before a `whatsapp_send_template`
call, the resource is faster and cheaper. For agent-driven
filtering ("show me all pending marketing templates"), the tool
is the right choice.

## Constants

```ts
import {
  WINDOW_RESOURCE_NAME,
  WINDOW_RESOURCE_URI_TEMPLATE, // "whatsapp://window/{phone}"
  TEMPLATES_RESOURCE_NAME,
  TEMPLATES_RESOURCE_URI, // "whatsapp://templates"
  TEMPLATES_CACHE_TTL_MS, // 60_000
} from "@dojocoding/whatsapp-mcp";
```

## What's not here

- **Inbound-message resources.** No `whatsapp://messages/{wamid}`
  or `whatsapp://conversations/{phone}`. The MCP server doesn't
  see inbound traffic; that lives in your webhook receiver.
- **Resource subscriptions.** The MCP spec defines
  `resources/subscribe` for push notifications when a resource
  changes, but Claude Desktop doesn't implement subscriptions
  yet. The two resources here are read-only and unsubscribable.
- **Conversation history.** Meta's Cloud API doesn't expose
  message history via the Graph API (unlike Slack), so there's
  no resource we can ship. To make history available to the
  agent, persist it yourself in the SDK's webhook receiver and
  expose a custom resource via a programmatic `WhatsAppMcpServer`
  embedding.
