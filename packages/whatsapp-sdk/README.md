# @dojocoding/whatsapp-sdk

Typed TypeScript SDK for Meta's
[WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).
Modular, spec-driven via [OpenSpec](https://github.com/openspec-dev/openspec),
opinionated for agentic shapes — LLM orchestrators, multi-turn
bots, slot-collection flows, transactional pipelines, multi-tenant
deployments.

> **Sibling package:** [`@dojocoding/whatsapp-mcp`](https://www.npmjs.com/package/@dojocoding/whatsapp-mcp).
> Use this SDK directly when you're building a server (webhook
> receiver, multi-tenant API, queue worker). Use the sibling MCP
> server when you're wiring an LLM agent to send WhatsApp messages.
> Use both together for the agent ↔ customer loop —
> see [`docs/cookbook/hybrid/agent-handoff-loop.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/cookbook/hybrid/agent-handoff-loop.md).
>
> **Renamed from `@dojocoding/whatsapp` in `0.8.0`** — see the
> CHANGELOG `[0.8.0]` entry for the one-line migration.

## Install

```bash
pnpm add @dojocoding/whatsapp-sdk
# or: npm install @dojocoding/whatsapp-sdk
```

Peer deps (all optional — only pull the ones whose subpath you import):

```bash
pnpm add express   # for @dojocoding/whatsapp-sdk/express
pnpm add hono      # for @dojocoding/whatsapp-sdk/hono
pnpm add ioredis   # for @dojocoding/whatsapp-sdk/storage/redis
pnpm add pg        # for @dojocoding/whatsapp-sdk/storage/postgres
pnpm add @opentelemetry/api   # for OTel spans
```

## Use

A 30-line outbound + inbound scaffold:

```ts
import express from "express";
import {
  InMemoryStorage,
  WebhookReceiver,
  WhatsAppClient,
  WindowTracker,
} from "@dojocoding/whatsapp-sdk";
import { createWhatsAppMiddleware } from "@dojocoding/whatsapp-sdk/express";

const storage = new InMemoryStorage();
const windowTracker = new WindowTracker({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  storage,
});
const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  windowTracker,
});

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  storage,
});
receiver.on("message", async (event) => {
  await windowTracker.notifyInbound(event.from);
  if (event.message.type === "text") {
    await client.sendText({ to: event.from, body: `You said: ${event.message.text}` });
  }
});

const app = express();
app.use("/webhooks/whatsapp", createWhatsAppMiddleware({ receiver }));
app.listen(3000);
```

## What this package is / is NOT

- **Is**: a typed client for every outbound WhatsApp Cloud API
  endpoint (`sendText`, `sendImage`, `sendTemplate`,
  `sendInteractive`, ...) + a webhook receiver with HMAC
  verification + dedupe + 24-hour-window tracking + framework
  adapters for Express, Hono, and the web fetch standard.
- **Is**: opinionated about agentic concerns — typed errors with
  discriminator codes, observability hooks for OpenTelemetry,
  pluggable `Storage` for window / dedupe state (in-memory /
  Redis / Postgres).
- **Is NOT**: an MCP server. To put this SDK in front of an LLM
  agent (Claude Desktop, Agent SDK), install the sibling
  [`@dojocoding/whatsapp-mcp`](https://www.npmjs.com/package/@dojocoding/whatsapp-mcp).
- **Is NOT**: a media upload helper. `client.uploadMedia()`
  exists, but for most flows pass a public `link` to send tools
  and let Meta fetch.

## Docs

→ [`docs/sdk/`](https://github.com/DojoCodingLabs/whatsapp-adapter/tree/main/docs/sdk)
on GitHub.

- [`quickstart.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/sdk/quickstart.md) —
  hello world.
- [`client.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/sdk/client.md),
  [`webhooks.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/sdk/webhooks.md),
  [`window.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/sdk/window.md) —
  the three capability cores.
- [`messages.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/sdk/messages.md),
  [`templates.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/sdk/templates.md) —
  every send / template shape.
- [`storage.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/sdk/storage.md),
  [`queue.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/sdk/queue.md),
  [`observability.md`](https://github.com/DojoCodingLabs/whatsapp-adapter/blob/main/docs/sdk/observability.md) —
  state, throughput, instrumentation.

Cookbook recipes:
[`docs/cookbook/sdk/`](https://github.com/DojoCodingLabs/whatsapp-adapter/tree/main/docs/cookbook/sdk)
(inbound auto-responder, two-way support, transactional,
appointment booking, multi-tenant, Workers, Hono).

## License

MIT © Dojo Coding LLC.
