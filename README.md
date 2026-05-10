# `@dojocoding/whatsapp`

A typed, opinionated TypeScript adapter for Meta's
[WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).
Built spec-first via [OpenSpec](https://github.com/openspec-dev/openspec)
for the Dojo Coding agentic front-desk platform.

> **Status:** pre-alpha — public API surface stable enough for internal
> consumers, but minor breaking changes can still happen between OpenSpec
> archives. Check `openspec/changes/` before pinning a SHA.

## What this is

Eight capability slices that compose into a complete Cloud API client +
webhook receiver:

- **Outbound** — typed builders for every send-able WhatsApp message
  (text, media, location, contacts, interactive button/list/cta_url,
  template, reaction, reply); retry on 5xx + Meta rate-limit codes;
  client-side idempotency keying.
- **Inbound** — verify-token handshake, raw-body HMAC-SHA256
  verification, polymorphic event parsing, dedupe by `wamid`,
  framework-agnostic dispatch.
- **24-hour window enforcement** — `WindowTracker` with pluggable
  `Storage` so free-form sends throw `WindowClosedError` _before_ the
  HTTP call.
- **Template management** — list / get approved templates,
  cross-validate `{{N}}` placeholders before send.
- **Mock mode** — `MockWhatsAppClient` parity-tested with the real
  client; no Meta credentials needed for CI / dev.
- **Observability** — OpenTelemetry spans on every Graph call and every
  webhook handler invocation; PII-redacting salted hash for
  `phone_number_id`.
- **Framework adapter** — Express middleware sub-module
  (`@dojocoding/whatsapp/express`) that handles raw-body capture,
  ack-within-30s, and method routing.

## Why this exists

The Meta-published Node SDK
([`WhatsApp/WhatsApp-Nodejs-SDK`](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK))
was archived in June 2023. The most popular community alternative
([`tawn33y/whatsapp-cloud-api`](https://github.com/tawn33y/whatsapp-cloud-api))
was archived in July 2024. This SDK fills that gap with stricter typing,
explicit 24-hour-window enforcement, mock parity, and OpenSpec-grounded
discipline. See [`docs/compatibility.md`](./docs/compatibility.md) for
the comparison vs the actively-maintained leader,
[`Secreto31126/whatsapp-api-js`](https://github.com/Secreto31126/whatsapp-api-js).

## Install

```bash
pnpm add @dojocoding/whatsapp
# Optional: OpenTelemetry peer dependency for spans
pnpm add @opentelemetry/api
```

Requires Node ≥ 20 LTS. Ships dual ESM + CJS via `tsup`.

## Quickstart

Send a message:

```ts
import { WhatsAppClient } from "@dojocoding/whatsapp";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  token: process.env.WHATSAPP_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
});

await client.sendText({ to: "521234567890", body: "Hi 👋" });
```

Receive webhooks (Express):

```ts
import express from "express";
import { WebhookReceiver } from "@dojocoding/whatsapp";
import { createWhatsAppMiddleware } from "@dojocoding/whatsapp/express";

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});

receiver.on("message", async (e) => console.log("msg from", e.from));

const app = express();
app.use("/webhooks/whatsapp", createWhatsAppMiddleware(receiver));
//                              ^ register BEFORE any global express.json()
app.listen(3000);
```

The full walkthrough — including window-tracker wiring, mock mode, and
OTel — lives at [`docs/quickstart.md`](./docs/quickstart.md).

## Building real things

Beyond the quickstart, two doc trees cover usage:

- **[`docs/cookbook/`](./docs/cookbook/)** — runnable recipes for the
  common shapes: inbound auto-responder, transactional notifications,
  two-way support with HITL handoff, appointment booking, multi-tenant
  deployment.
- **[`docs/patterns.md`](./docs/patterns.md)** — composable patterns
  the recipes are built from: window-aware send, idempotent handler,
  escalation, token rotation, rate-limit-aware queue, replay-safe
  sends, test layering.

For AI agents (Claude Code / Claude API / similar) generating code
that uses this SDK, the operating context lives in
**[`AGENTS.md`](./AGENTS.md)** and **[`CLAUDE.md`](./CLAUDE.md)**.

## Capabilities

| Capability          | Doc                                                | Spec                                                                                         |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Cloud API client    | [`docs/client.md`](./docs/client.md)               | [`openspec/specs/cloud-api-client/spec.md`](./openspec/specs/cloud-api-client/spec.md)       |
| Message builders    | [`docs/messages.md`](./docs/messages.md)           | [`openspec/specs/message-builders/spec.md`](./openspec/specs/message-builders/spec.md)       |
| Webhook receiver    | [`docs/webhooks.md`](./docs/webhooks.md)           | [`openspec/specs/webhook-receiver/spec.md`](./openspec/specs/webhook-receiver/spec.md)       |
| 24h window tracker  | [`docs/window.md`](./docs/window.md)               | [`openspec/specs/window-tracker/spec.md`](./openspec/specs/window-tracker/spec.md)           |
| Template management | [`docs/templates.md`](./docs/templates.md)         | [`openspec/specs/template-management/spec.md`](./openspec/specs/template-management/spec.md) |
| Mock mode           | [`docs/mock.md`](./docs/mock.md)                   | [`openspec/specs/mock-mode/spec.md`](./openspec/specs/mock-mode/spec.md)                     |
| Observability       | [`docs/observability.md`](./docs/observability.md) | [`openspec/specs/observability/spec.md`](./openspec/specs/observability/spec.md)             |
| Express adapter     | [`docs/express.md`](./docs/express.md)             | [`openspec/specs/framework-adapters/spec.md`](./openspec/specs/framework-adapters/spec.md)   |

The architecture diagram and capability map are at
[`docs/architecture.md`](./docs/architecture.md).

## Environment

The SDK doesn't auto-load `.env` — that's your app's job. Required env
vars (used by the docs and tests):

- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_WABA_ID`
- `WHATSAPP_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN` (your choice; shared with Meta's webhook UI)

Optional:

- `WHATSAPP_MODE=mock` — switches `pickWhatsAppClient` to the mock
- `WHATSAPP_E2E=1` — unskips the nightly real-Meta integration tests

Copy [`.env.example`](./.env.example) to start.

## Compliance highlights

The SDK enforces these Meta rules in code:

- **Raw-body HMAC-SHA256** with timing-safe compare on every webhook.
- **30-second ack** to Meta — handlers run async on the dispatch promise.
- **Dedupe by `wamid`** to absorb Meta's up-to-7-day delivery retries.
- **24-hour customer-service window** with pre-flight client-side gate.
- **1-indexed contiguous `{{N}}` placeholders** in templates.
- **PII redaction** on observability spans (`phone_number_id` hashed).

The full list, plus rules you must enforce yourself and current
divergences from latest Meta guidance (e.g. Graph API version pin), is at
[`docs/compliance.md`](./docs/compliance.md).

## Spec-driven development

Every meaningful change is proposed as an OpenSpec change before
implementation. Specs live under `openspec/specs/`; active proposals
under `openspec/changes/`. CI validates both.

```bash
openspec new change <name>            # scaffold proposal/design/tasks
openspec validate --change <name>     # lint
# … implement against the proposal …
openspec archive <name>               # merge spec deltas into specs/
```

The "Domain rules — never violate" block in
[`openspec/config.yaml`](./openspec/config.yaml) is the canonical
constraint list. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full
workflow.

## What this is NOT (v1)

Voice / Calls API, Flows beyond send-only `interactive.flow`,
Click-to-WhatsApp >72 h, quality dashboards, template-authoring UI,
Embedded Signup UI. The MCP wrapper (`dojo-conversation-state-mcp`) is a
separate package.

This SDK targets Meta's **Cloud API** only. It is not a WhatsApp Web
client (so not Baileys, whatsapp-web.js, `openclaw/wacli`, or any
`whatsmeow`-based tool). The trust model and the public API are both
different — see
[`docs/compatibility.md`](./docs/compatibility.md#where-this-sdk-fits).

## Repo layout

```
src/
  client/         # cloud API client (transport, retry, errors, health)
  messages/       # builders + send + types
  webhooks/       # handshake, signature, parser, dedupe, receiver, events
  window/         # 24h tracker
  templates/      # list/get + placeholder counter + validateTemplateSend
  mock/           # MockWhatsAppClient + pickWhatsAppClient
  observability/  # withSpan + redact salt
  adapters/       # express middleware
  storage/        # Storage interface + InMemoryStorage
  types/          # constants, error classes
  index.ts
test/
  unit/             # one suite per src module
  contract/         # public API surface vs spec scenarios
  integration/      # framework adapters (Express + supertest)
  parity/           # MockWhatsAppClient ⇆ WhatsAppClient
  __fixtures__/     # captured PII-redacted Meta payloads
docs/             # consumer-facing reference (this is what you're reading)
openspec/
  specs/<cap>/spec.md   # stable spec per capability
  changes/<name>/       # active proposals (and archive/)
  config.yaml           # domain rules + conventions
```

## Reporting

- **Issues:** internal tracker for bugs, missing capability, etc.
- **Security:** see [`SECURITY.md`](./SECURITY.md) — do not file in the
  public tracker.
- **Contributing:** see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

UNLICENSED — internal use within Dojo Coding LLC only.
