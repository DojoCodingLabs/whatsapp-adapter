# Architecture

This SDK is split into eight capabilities, each with a stable public API
exported from its own folder. The split is deliberate — each capability is
spec'd independently under `openspec/specs/<capability>/spec.md`, can be
swapped in tests, and depends only on what's strictly necessary.

## Capability map

| Capability            | Folder                  | Responsibility                                                                                                                                                |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud-api-client`    | `src/client/`           | Authenticated HTTP transport against `graph.facebook.com`, retry with full-jitter backoff, error-code mapping, `/debug_token` health check                    |
| `message-builders`    | `src/messages/`         | Typed wire-payload builders for every send-able message; the `WhatsAppMessage` discriminated union                                                            |
| `webhook-receiver`    | `src/webhooks/`         | Verify-token handshake, raw-body HMAC verification, polymorphic event parsing, dedupe, framework-agnostic dispatch                                            |
| `window-tracker`      | `src/window/`           | 24-hour customer-service-window tracking with pluggable `Storage`                                                                                             |
| `template-management` | `src/templates/`        | List / get approved templates, placeholder counting, pre-flight cross-validation of template sends                                                            |
| `mock-mode`           | `src/mock/`             | In-memory `MockWhatsAppClient` and the `pickWhatsAppClient` factory; satisfies the same `WhatsAppLikeClient` interface as the real client                     |
| `observability`       | `src/observability/`    | OpenTelemetry `withSpan` wrapper, PII-redacting phone-number-id hash, redaction-salt configuration                                                            |
| `framework-adapters`  | `src/adapters/web/`     | Fetch-API (`Request → Response`) core sub-module published at `@dojocoding/whatsapp/web`. Runs unmodified on Workers / Bun / Deno / Hono / Next.js App Router |
| `framework-adapters`  | `src/adapters/express/` | Express middleware sub-module published at `@dojocoding/whatsapp/express`; thin shim over the web core                                                        |
| `framework-adapters`  | `src/adapters/hono/`    | Hono `Handler` sub-module published at `@dojocoding/whatsapp/hono`; one-line wrapper over the web core                                                        |
| `outbound-queue`      | `src/queue/`            | `TokenBucket`, `BucketMap`, and the `withRateLimit(client, options?)` decorator that throttles `send*` calls per-pair (1 / 6 s) and per-WABA (default 80 MPS) |

A small shared `Storage` interface lives at `src/storage/index.ts` and is
re-exported through both the webhook and window capabilities.

## Outbound flow

How a `client.sendText({ to, body })` call reaches Meta:

```
   ┌───────────────────────────────┐
   │ WhatsAppClient.sendText(input)│  src/client/whatsapp-client.ts
   └─────────────┬─────────────────┘
                 │
                 ▼
   ┌───────────────────────────────┐
   │ WindowTracker.isWindowOpen?   │  pre-flight; throws WindowClosedError
   │  (skipped for template /      │  before any HTTP if window is closed
   │   reaction)                   │  src/window/tracker.ts
   └─────────────┬─────────────────┘
                 │
                 ▼
   ┌───────────────────────────────┐
   │ buildText({ to, body }) →     │  src/messages/builders.ts
   │  validated WhatsAppMessage    │
   └─────────────┬─────────────────┘
                 │
                 ▼
   ┌───────────────────────────────┐
   │ sendMessage(client, payload)  │  POST /{phoneNumberId}/messages
   │   = client.request("POST", …) │  src/messages/send.ts
   └─────────────┬─────────────────┘
                 │
                 ▼
   ┌───────────────────────────────┐
   │ withSpan("whatsapp.request") │  src/observability/tracing.ts
   │  ▸ retry loop (full jitter)   │  src/client/retry.ts
   │     ▸ doFetch (Bearer +       │  src/client/transport.ts
   │       X-Dojo-Idempotency-Key) │
   └─────────────┬─────────────────┘
                 │
                 ▼
        graph.facebook.com/v25.0/...
```

Failure path: a 4xx with a Meta error envelope passes through
`mapMetaError` (`src/client/errors.ts`), which produces a typed
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
   │ Express middleware            │  src/adapters/express/index.ts
   │  express.raw({ type: …json }) │  ← captures raw bytes BEFORE parse
   └─────────────┬─────────────────┘
                 │
                 ▼
   ┌───────────────────────────────┐
   │ receiver.handlePayload(       │  src/webhooks/receiver.ts
   │   rawBody, sigHeader, parsed) │
   │  1. verifySignature           │  src/webhooks/signature.ts
   │     (timing-safe HMAC-SHA256) │
   │  2. parseWebhookPayload       │  src/webhooks/parser.ts
   │     → ReadonlyArray<Event>    │
   └─────────────┬─────────────────┘
                 │ status 200 returned IMMEDIATELY
                 │ (Meta's 30s ack rule)
                 ▼
   ┌───────────────────────────────┐
   │ #dispatch(events)             │  runs async on dispatchPromise
   │  for each event:              │
   │   1. WebhookDeduper.markIfNew │  src/webhooks/dedupe.ts
   │      (skip duplicates)        │
   │   2. withSpan(                │  src/observability/tracing.ts
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
`WhatsAppLikeClient` interface (`src/mock/types.ts`). Consumer code that
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
- **Idempotency hint, not a contract.** `X-Dojo-Idempotency-Key` is a
  custom header for client-side correlation. Meta does NOT honour it; do
  not rely on it for de-duplication on Meta's side.

## What lives where (file index)

```
src/
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
