# `@dojocoding/whatsapp`

Internal SDK that wraps Meta's WhatsApp **Cloud API** (Graph API based) for the agentic front-desk system.

> **Status**: pre-alpha. Built spec-first via [OpenSpec](https://github.com/openspec-dev/openspec). See `openspec/` for capability specs and active change proposals.

## What this is

A typed, opinionated TypeScript adapter that other internal services depend on. It encapsulates:

- **Outbound**: typed builders for every WhatsApp message type (text, media, interactive, template, reaction, reply), retry on 5xx + WhatsApp rate-limit codes, client-side idempotency.
- **Inbound**: webhook handshake, raw-body HMAC-SHA256 verification, polymorphic event parsing, dedupe by `wamid`, handler registration.
- **Business rules**: 24-hour customer-service-window enforcement, per-pair rate limit, error-code → typed-error mapping.
- **Mock mode**: full operation without Meta credentials for CI and local dev.
- **Observability**: OpenTelemetry spans on every send and every webhook handler invocation, no-op when no tracer is registered.
- **Framework adapter**: Express middleware sub-module (`@dojocoding/whatsapp/express`).

## What this is NOT (v1)

Voice / Calls API, Flows beyond send-only `interactive.flow`, Click-to-WhatsApp >72h, quality dashboards, template authoring UI, Embedded Signup UI. The MCP wrapper (`dojo-conversation-state-mcp`) is a separate package.

## Spec-driven development

Every meaningful change is proposed as an OpenSpec change before implementation:

```
openspec new change <name>            # scaffold
openspec instructions <id> --change … # get artifact templates
openspec validate --change <name>     # lint
openspec archive <name>               # merge deltas into specs/
```

Capabilities (after Phase 0):

| Capability | Owns |
|---|---|
| `cloud-api-client` | Graph HTTP client, auth, retry, version pin, error code mapping |
| `message-builders` | Typed discriminated-union sends + replies + reactions |
| `webhook-receiver` | Handshake, HMAC verify, raw-body capture, dedupe, dispatch |
| `window-tracker` | 24h window enforcement + pluggable Storage |
| `template-management` | List/send templates + status webhook events |
| `mock-mode` | In-memory simulator for CI/dev (no Meta creds) |
| `observability` | OTel spans, metrics, redacted attributes |
| `framework-adapters` | Express middleware sub-module |

See `openspec/specs/` for stable specs and `openspec/changes/` for active proposals.

## Layout

```
src/
  client/         # cloud API client (Phase 1)
  messages/       # builders (Phase 2)
  webhooks/       # receiver, signature, dedupe (Phase 3)
  window/         # 24h tracker (Phase 4)
  templates/      # template ops (Phase 5)
  mock/           # mock mode (Phase 6)
  observability/  # OTel (Phase 7)
  adapters/       # express (Phase 8)
  types/          # shared types, error classes
  index.ts
test/
  unit/
  fixtures/
  contract/
  integration/
  parity/
  __fixtures__/webhooks/   # captured PII-redacted Meta payloads
```

## License

UNLICENSED — internal use within Dojocoding only.
