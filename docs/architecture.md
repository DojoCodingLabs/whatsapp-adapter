# Architecture

This repository ships two coordinated npm packages in a single
pnpm workspace:

```
                        ┌──────────────────────────────┐
                        │  Your application process     │
                        │                                │
   Meta webhook  ─────▶ │  WebhookReceiver (SDK)         │
                        │      │                         │
                        │      ▼                         │
                        │  WindowTracker + Storage       │
                        │      │                         │
                        │      ▼ tracker.notifyInbound() │
                        │                                │
                        │  ◀── WhatsAppClient (SDK) ─▶  │ ──▶ Meta Graph API
                        │           ▲                    │
                        │           │ reference shared   │
                        │           │ across both halves │
                        │           │                    │
                        │      WhatsAppMcpServer (MCP)   │
                        │      stdio / in-memory         │
                        └─────────────┬──────────────────┘
                                      │
                                      ▼
                              MCP-compatible host
                  (Claude Desktop, Claude Agent SDK, ...)
```

- **`@dojocoding/whatsapp-sdk`** — the typed Cloud API client +
  webhook receiver + storage / window / queue primitives. Your
  application code talks to this directly.
- **`@dojocoding/whatsapp-mcp`** — a thin Model Context Protocol
  server that wraps the SDK's outbound surface as LLM-callable
  tools. An MCP host (Claude Desktop, the Claude Agent SDK,
  Cursor, Cline) talks to this; this talks to the SDK.

The integration point between the two halves is the SDK's
`WhatsAppClient` + `WindowTracker` + `Storage`. The MCP server
takes a `WhatsAppLikeClient` instance and reads from a
`WindowTracker` — whatever your application wired into the SDK
(in-memory state, Redis, Postgres) automatically flows through
the MCP server's tools and resources.

For when-to-use-which, see
[`when-to-use-which.md`](./when-to-use-which.md). For the
canonical agent-handoff pattern using both packages together,
see
[`cookbook/hybrid/agent-handoff-loop.md`](./cookbook/hybrid/agent-handoff-loop.md).

## SDK internals (`@dojocoding/whatsapp-sdk`)

The SDK is split into eight capabilities, each with a stable
public API exported from its own folder. The split is deliberate
— each capability is spec'd independently under
`openspec/specs/<capability>/spec.md`, can be swapped in tests,
and depends only on what's strictly necessary.

## Capability map

| Capability            | Folder                                          | Responsibility                                                                                                                                                    |
| --------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud-api-client`    | `packages/whatsapp-sdk/src/client/`             | Authenticated HTTP transport against `graph.facebook.com`, retry with full-jitter backoff, error-code mapping, `/debug_token` health check                        |
| `message-builders`    | `packages/whatsapp-sdk/src/messages/`           | Typed wire-payload builders for every send-able message; the `WhatsAppMessage` discriminated union                                                                |
| `webhook-receiver`    | `packages/whatsapp-sdk/src/webhooks/`           | Verify-token handshake, raw-body HMAC verification, polymorphic event parsing, dedupe, framework-agnostic dispatch                                                |
| `window-tracker`      | `packages/whatsapp-sdk/src/window/`             | 24-hour customer-service-window tracking with pluggable `Storage`                                                                                                 |
| `template-management` | `packages/whatsapp-sdk/src/templates/`          | List / get approved templates, placeholder counting, pre-flight cross-validation of template sends                                                                |
| `mock-mode`           | `packages/whatsapp-sdk/src/mock/`               | In-memory `MockWhatsAppClient` and the `pickWhatsAppClient` factory; satisfies the same `WhatsAppLikeClient` interface as the real client                         |
| `observability`       | `packages/whatsapp-sdk/src/observability/`      | OpenTelemetry `withSpan` wrapper, PII-redacting phone-number-id hash, redaction-salt configuration                                                                |
| `framework-adapters`  | `packages/whatsapp-sdk/src/adapters/web/`       | Fetch-API (`Request → Response`) core sub-module published at `@dojocoding/whatsapp-sdk/web`. Runs unmodified on Workers / Bun / Deno / Hono / Next.js App Router |
| `framework-adapters`  | `packages/whatsapp-sdk/src/adapters/express/`   | Express middleware sub-module published at `@dojocoding/whatsapp-sdk/express`; thin shim over the web core                                                        |
| `framework-adapters`  | `packages/whatsapp-sdk/src/adapters/hono/`      | Hono `Handler` sub-module published at `@dojocoding/whatsapp-sdk/hono`; one-line wrapper over the web core                                                        |
| `outbound-queue`      | `packages/whatsapp-sdk/src/queue/`              | `TokenBucket`, `BucketMap`, and the `withRateLimit(client, options?)` decorator that throttles `send*` calls per-pair (1 / 6 s) and per-WABA (default 80 MPS)     |
| `storage` (Redis)     | `packages/whatsapp-sdk/src/storage/redis.ts`    | `createRedisStorage(client, options?)` at `@dojocoding/whatsapp-sdk/storage/redis`. Implements `Storage` against an `ioredis`-compatible client.                  |
| `storage` (Postgres)  | `packages/whatsapp-sdk/src/storage/postgres.ts` | `createPostgresStorage(client, options?)` at `@dojocoding/whatsapp-sdk/storage/postgres`. Implements `Storage` against a `pg`-compatible client.                  |

A small shared `Storage` interface lives at `packages/whatsapp-sdk/src/storage/index.ts` and is
re-exported through both the webhook and window capabilities.

## Outbound flow

How a `client.sendText({ to, body })` call reaches Meta:

```
   ┌───────────────────────────────┐
   │ WhatsAppClient.sendText(input)│  packages/whatsapp-sdk/src/client/whatsapp-client.ts
   └─────────────┬─────────────────┘
                 │
                 ▼
   ┌───────────────────────────────┐
   │ WindowTracker.isWindowOpen?   │  pre-flight; throws WindowClosedError
   │  (skipped for template /      │  before any HTTP if window is closed
   │   reaction)                   │  packages/whatsapp-sdk/src/window/tracker.ts
   └─────────────┬─────────────────┘
                 │
                 ▼
   ┌───────────────────────────────┐
   │ buildText({ to, body }) →     │  packages/whatsapp-sdk/src/messages/builders.ts
   │  validated WhatsAppMessage    │
   └─────────────┬─────────────────┘
                 │
                 ▼
   ┌───────────────────────────────┐
   │ sendMessage(client, payload)  │  POST /{phoneNumberId}/messages
   │   = client.request("POST", …) │  packages/whatsapp-sdk/src/messages/send.ts
   └─────────────┬─────────────────┘
                 │
                 ▼
   ┌───────────────────────────────┐
   │ withSpan("whatsapp.request") │  packages/whatsapp-sdk/src/observability/tracing.ts
   │  ▸ retry loop (full jitter)   │  packages/whatsapp-sdk/src/client/retry.ts
   │     ▸ doFetch (Bearer +       │  packages/whatsapp-sdk/src/client/transport.ts
   │       X-Request-Id)           │
   └─────────────┬─────────────────┘
                 │
                 ▼
        graph.facebook.com/v25.0/...
```

Failure path: a 4xx with a Meta error envelope passes through
`mapMetaError` (`packages/whatsapp-sdk/src/client/errors.ts`), which produces a typed
`WhatsAppError` subclass. Retryable error codes (`130429`, `131048`,
`131056`, `131053`) and HTTP statuses (408, 429, 5xx) re-enter the retry
loop with full-jitter backoff and `Retry-After` honoured. Everything else
propagates immediately.

## Inbound flow

How a Meta webhook delivery reaches your handler:

```
   POST /webhooks/whatsapp
        body: <raw JSON bytes>
        X-Hub-Signature-256: sha256=…
                 │
                 ▼
   ┌───────────────────────────────┐
   │ Express middleware            │  packages/whatsapp-sdk/src/adapters/express/index.ts
   │  express.raw({ type: …json }) │  ← captures raw bytes BEFORE parse
   └─────────────┬─────────────────┘
                 │
                 ▼
   ┌───────────────────────────────┐
   │ receiver.handlePayload(       │  packages/whatsapp-sdk/src/webhooks/receiver.ts
   │   rawBody, sigHeader, parsed) │
   │  1. verifySignature           │  packages/whatsapp-sdk/src/webhooks/signature.ts
   │     (timing-safe HMAC-SHA256) │
   │  2. parseWebhookPayload       │  packages/whatsapp-sdk/src/webhooks/parser.ts
   │     → ReadonlyArray<Event>    │
   └─────────────┬─────────────────┘
                 │ status 200 returned IMMEDIATELY
                 │ (Meta's 30s ack rule)
                 ▼
   ┌───────────────────────────────┐
   │ #dispatch(events)             │  runs async on dispatchPromise
   │  for each event:              │
   │   1. WebhookDeduper.markIfNew │  packages/whatsapp-sdk/src/webhooks/dedupe.ts
   │      (skip duplicates)        │
   │   2. withSpan(                │  packages/whatsapp-sdk/src/observability/tracing.ts
   │       "whatsapp.webhook.      │
   │        dispatch")             │
   │   3. invoke registered        │
   │      handlers (Promise.       │
   │      allSettled)              │
   └───────────────────────────────┘
```

The 200 ack is sent **before** `dispatchPromise` is awaited. Slow handlers
do not delay the ack, which would otherwise risk Meta retrying for up to 7
days.

## The `WhatsAppLikeClient` boundary

`MockWhatsAppClient` and `WhatsAppClient` both implement the same
`WhatsAppLikeClient` interface (`packages/whatsapp-sdk/src/mock/types.ts`). Consumer code that
takes the union runs unchanged against either backend:

```ts
function postWelcome(client: WhatsAppLikeClient, to: string) {
  return client.sendTemplate({ to, name: "welcome", language: "en_US" });
}
```

The `pickWhatsAppClient(options)` factory returns a real or mock client
based on `process.env.WHATSAPP_MODE` (or the `forceReal` / `forceMock`
overrides). See [`mock.md`](./mock.md).

## Cross-cutting concerns

A handful of design choices apply across more than one capability:

- **Zero global state.** No singletons. One client / receiver / tracker
  per WABA-phone pair. Multi-WABA tenancy is built in, not retrofitted.
- **Pluggable `Storage` interface.** Both `WindowTracker` and
  `WebhookDeduper` take a `Storage` (default: `InMemoryStorage`). Swap in
  a Redis or Postgres adapter for multi-process deployments.
- **OpenTelemetry, opt-in.** `withSpan` always runs, but if no global
  tracer provider is registered the OTel API returns a no-op tracer. The
  SDK never depends on a specific exporter being installed.
- **PII redaction.** `phone_number_id` and `waba_id` appear on spans only
  via `hashPhoneNumberId(...)`. Set `setRedactSalt(env)` once at boot.
- **Request correlation.** Every outbound Graph API call carries an
  `X-Request-Id: <uuid v4>` header (the same id is recorded on the
  OTel span as `whatsapp.request.id`). Stable across the SDK's retry
  attempts of one logical call. **NOT an idempotency / dedup
  signal** — Meta does not consult any SDK-attached header for
  outbound deduplication; a retry of `POST /messages` with the same
  request id produces a new send. Real outbound dedup is post-1.0
  (the `outbound-deduper` capability on the v2 roadmap).

## What lives where (file index)

```
packages/whatsapp-sdk/src/
├── client/
│   ├── whatsapp-client.ts   # WhatsAppClient class + send convenience methods
│   ├── transport.ts         # request(), buildGraphUrl, OTel span attachment
│   ├── retry.ts             # retry(), full-jitter backoff, parseRetryAfter
│   ├── errors.ts            # mapMetaError(), isRetryableHttpStatus
│   └── health.ts            # healthCheck() against /debug_token
├── messages/
│   ├── types.ts             # WhatsAppMessage discriminated union, MessageSendResponse
│   ├── builders.ts          # buildText / buildImage / … / buildReaction
│   └── send.ts              # sendMessage(client, payload)
├── webhooks/
│   ├── handshake.ts         # verifyHandshake()
│   ├── signature.ts         # verifySignature(), computeSignature()
│   ├── parser.ts            # parseWebhookPayload()
│   ├── dedupe.ts            # WebhookDeduper
│   ├── events.ts            # WhatsAppEvent union
│   └── receiver.ts          # WebhookReceiver class
├── window/
│   └── tracker.ts           # WindowTracker class
├── templates/
│   ├── api.ts               # listTemplates(), getTemplate()
│   ├── placeholders.ts      # countTemplatePlaceholders()
│   ├── validate.ts          # validateTemplateSend()
│   └── types.ts             # TemplateDefinition, ListTemplatesQuery, …
├── mock/
│   ├── client.ts            # MockWhatsAppClient
│   ├── factory.ts           # pickWhatsAppClient()
│   └── types.ts             # WhatsAppLikeClient interface, RecordedSend
├── observability/
│   ├── tracing.ts           # withSpan(), getTracer()
│   └── redact.ts            # hashPhoneNumberId(), setRedactSalt()
├── adapters/
│   └── express/index.ts     # createWhatsAppMiddleware()
├── storage/
│   └── index.ts             # Storage interface + InMemoryStorage
├── types/
│   ├── constants.ts         # GRAPH_API_VERSION, META_GRAPH_BASE_URL, TTLs
│   └── errors.ts            # WhatsAppError + 6 typed subclasses
└── index.ts                 # Public entry — barrel re-exports
```

The build (`tsup`) emits ESM + CJS for both the root and the Express
sub-module. See `package.json` `exports` for the public entry points.

## MCP server (`@dojocoding/whatsapp-mcp`)

Sibling package living under `packages/whatsapp-mcp/`. The MCP
server is a thin wrapper over the SDK's outbound surface — it
holds no state of its own beyond the in-process templates cache.

### Layout

```
packages/whatsapp-mcp/src/
├── cli.ts                 # #!/usr/bin/env node — bin entry
├── env.ts                 # env-var + CLI-flag loader
├── server.ts              # buildServer() + WhatsAppMcpServer class
├── errors.ts              # mapSdkError(), withErrorMapping()
├── output-schemas.ts      # pinned 3-field SendResult shape
├── tools/                 # one file per tool — 16 in total
│   ├── context.ts         # ServerContext (client + wabaPhoneNumberId)
│   ├── send-text.ts, send-image.ts, send-video.ts, ...
│   ├── send-interactive-buttons.ts, send-interactive-list.ts
│   ├── send-template.ts, send-auth-template.ts, send-carousel-template.ts
│   ├── send-reaction.ts
│   └── list-templates.ts, get-template.ts
├── resources/
│   ├── window.ts          # whatsapp://window/{phone}
│   └── templates.ts       # whatsapp://templates (60s in-process cache)
├── prompts/
│   └── wa-template-send.ts
└── index.ts               # Public barrel — WhatsAppMcpServer + name constants
```

### Flow — agent tool call → SDK send

```
   MCP host (Claude Desktop) ──JSON-RPC stdio──▶ McpServer
                                                    │
                                                    ▼
                                          zod inputSchema parse
                                          (validation fail → isError)
                                                    │
                                                    ▼
                                          withErrorMapping(async () => {
                                            ctx.client.sendText(...)
                                          })  ← drops into the SDK
                                                    │
                                                    ▼
                                          SDK outbound pipeline (above)
                                                    │
                                                    ▼
                          success: structuredContent { messageId, recipientPhone, wabaPhoneNumberId }
                          failure: mapSdkError → isError + recovery hint
                                                    │
                                          ──JSON-RPC stdio──▶ MCP host
```

### Integration with the SDK

The MCP server takes a `WhatsAppLikeClient` (interface, not the
concrete class) so consumers can substitute:

- `WhatsAppClient` — the real SDK client.
- `MockWhatsAppClient` — used by the MCP package's contract
  tests.
- A custom wrapper — e.g. the consent-gated client in
  [`cookbook/hybrid/compliance-broadcast.md`](./cookbook/hybrid/compliance-broadcast.md).

The `whatsapp://window/{phone}` resource takes an optional
`WindowTracker` — when present (in-process embedding), the
resource returns accurate state; when absent (default `npx`
standalone case), it returns `isOpen: false` with an
explanatory notice.

### Transport

stdio only in v1. The bin emits a shebang and `chmod +x`'s
itself at build time. JSON-RPC over stdin/stdout; all
diagnostics go to stderr (writing to stdout outside the
JSON-RPC framing corrupts the host's parser).

Programmatic embedding accepts any class implementing the MCP
SDK's `Transport` interface — the contract tests and the
Claude Agent SDK pattern use `InMemoryTransport`.
