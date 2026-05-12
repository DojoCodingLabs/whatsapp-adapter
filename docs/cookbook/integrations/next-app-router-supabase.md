# Cookbook — Next.js App Router + Supabase Postgres + Vercel

A complete recipe for running `@dojocoding/whatsapp-sdk` end-to-end
on the Site2Print-shape stack: Next.js App Router on Vercel
serverless, Supabase Postgres as the shared `Storage` backend,
and `@dojocoding/whatsapp-mcp`'s embedded toolset wired into the
same Next.js app for outbound agent actions.

If you only need outbound (a queue worker, a HITL UI, an agent
gateway) skip ahead to [§ "Outbound-only"](#5-outbound-only-no-receiver-needed).
If your agent layer is the Vercel Chat SDK, see also
[`docs/cookbook/coexistence/vercel-chat-sdk.md`](../coexistence/vercel-chat-sdk.md).

## What you'll build

```
Customer phone ──Meta─▶ POST /api/webhooks/whatsapp ──┐
                                                       ├─▶ Postgres (window + dedupe)
LLM agent ───MCP──▶ POST /api/mcp ──tool dispatch──┘
                          (whatsapp_send_text, etc.)
                          ▼
                    Meta Graph API
```

## 0. Prerequisites

- A Next.js 14+ App Router project deployed on Vercel.
- A Supabase project with the connection-pooler URL (port `6543`
  for transaction mode; we use parameterised queries only, so
  it's safe).
- A Meta WABA + test phone number + a System User token. See
  [`docs/mcp/quickstart.md`](../../mcp/quickstart.md) §
  "Connecting MCP → Claude Desktop → Meta" for the WABA
  walkthrough.

## 1. Install

```bash
pnpm add @dojocoding/whatsapp-sdk @dojocoding/whatsapp-mcp
pnpm add pg @vercel/functions
pnpm add -D @types/pg
```

## 2. Environment

```env
# .env.local + Vercel project env
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_BUSINESS_ACCOUNT_ID=9876543210
WHATSAPP_APP_SECRET=abc...
WHATSAPP_VERIFY_TOKEN=some-random-string-set-on-meta-dashboard
WHATSAPP_REDACT_SALT=per-environment-salt-for-otel-pii-hashing

# Supabase pooler (transaction mode is fine — we only do parameterised queries)
POSTGRES_URL=postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

## 3. Storage — Supabase Postgres for shared state

```ts
// lib/storage.ts
import { Pool } from "pg";

import { PostgresStorage } from "@dojocoding/whatsapp-sdk/storage/postgres";

let cachedPool: Pool | undefined;
let cachedStorage: PostgresStorage | undefined;

export function getStorage(): PostgresStorage {
  if (cachedStorage) return cachedStorage;
  if (!cachedPool) {
    cachedPool = new Pool({
      connectionString: process.env.POSTGRES_URL!,
      // pgbouncer transaction mode incompatible with prepared statements:
      // the SDK uses parameterised queries (NOT preparedStatement: true) so
      // we're fine, but be aware if you extend this connection elsewhere.
      max: 5,
    });
  }
  cachedStorage = new PostgresStorage({
    pool: cachedPool,
    schema: "whatsapp", // optional — defaults to "public"
  });
  return cachedStorage;
}
```

**Run the migration once** (the SDK ships the SQL — copy from
[`docs/sdk/storage.md`](../../sdk/storage.md)):

```sql
CREATE SCHEMA IF NOT EXISTS whatsapp;
CREATE TABLE IF NOT EXISTS whatsapp.kv (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS kv_expires_at_idx ON whatsapp.kv (expires_at);
```

## 4. Inbound — `/api/webhooks/whatsapp`

```ts
// app/api/webhooks/whatsapp/route.ts
import { waitUntil } from "@vercel/functions";

import { WebhookReceiver, WindowTracker } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHandler } from "@dojocoding/whatsapp-sdk/web";

import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const storage = getStorage();

const windowTracker = new WindowTracker({
  storage,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
});

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  storage, // shared Postgres for dedupe across cold starts
  redactSalt: process.env.WHATSAPP_REDACT_SALT,
});

receiver.on("message", async (e) => {
  // Keep the window tracker in sync — gates outbound free-form sends.
  await windowTracker.notifyInbound(e.from);

  // CTWA attribution — forward to Meta CAPI before responding.
  if (e.referral?.ctwa_clid) {
    await postToCapi({ ctwa_clid: e.referral.ctwa_clid, source_id: e.referral.source_id });
  }

  // Hand off to your agent / orchestrator.
  await yourAgent.onCustomerMessage({ from: e.from, body: e.body, wamid: e.id });
});

receiver.on("status", (e) => {
  // sent / delivered / read / failed — surface to your retry / follow-up cadence.
  yourEvents.recordStatus(e);
});

receiver.on("error", (err) => {
  console.error("[whatsapp/webhook] handler error:", err);
});

const handler = createWhatsAppHandler(receiver, { waitUntil });

export const GET = handler;
export const POST = handler;
```

Webhook URL: `https://your-app.vercel.app/api/webhooks/whatsapp`.
Meta dashboard → Configuration → Callback URL + verify token.
Subscribe to `messages` (and `message_template_status_update` if
you want template-approval status events).

## 5. Outbound (no receiver needed)

For your agent code, queue workers, or HITL operator UIs:

```ts
// lib/whatsapp.ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";

import { getStorage } from "./storage";
// Reuse the tracker from the webhook route so client-side window
// gating sees the same state. If your outbound code lives in a
// different process, construct a new tracker against the same
// storage — the storage is the source of truth.

let cached: WhatsAppClient | undefined;

export function getClient(): WhatsAppClient {
  if (cached) return cached;
  cached = new WhatsAppClient({
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
    token: process.env.WHATSAPP_ACCESS_TOKEN!,
    appSecret: process.env.WHATSAPP_APP_SECRET!,
    redactSalt: process.env.WHATSAPP_REDACT_SALT,
    // The webhook route's WindowTracker shares this Storage; the
    // outbound client wires its own tracker against the same backend
    // so free-form sends pre-flight against the same data.
    windowTracker: new (await import("@dojocoding/whatsapp-sdk")).WindowTracker({
      storage: getStorage(),
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    }),
  });
  return cached;
}
```

Usage in your agent:

```ts
import { WindowClosedError } from "@dojocoding/whatsapp-sdk";

import { getClient } from "@/lib/whatsapp";

const client = getClient();

try {
  await client.sendText({ to, body: "your booking is confirmed for Friday 3pm" });
} catch (err) {
  if (err instanceof WindowClosedError) {
    // Window closed — fall back to a template.
    await client.sendTemplate({ to, name: "booking_confirmation", language: "es_MX" });
  } else {
    throw err;
  }
}
```

## 6. Agent — `/api/mcp` with embedded WhatsApp tools

Site2Print-shape: your MCP gateway merges Dojo's 16 WhatsApp
tools with other upstreams (Alegra accounting, custom in-house
tools) behind one OAuth-protected `/api/mcp` endpoint.

The embedded-toolset cookbook documents the full pattern:
[`docs/cookbook/mcp/embedded-toolset.md`](../mcp/embedded-toolset.md).

Three integration points worth calling out for this stack:

```ts
// lib/mcp/whatsapp-toolset.ts
import { createWhatsAppToolset } from "@dojocoding/whatsapp-mcp";

import { getClient } from "@/lib/whatsapp";

let cached: ReturnType<typeof createWhatsAppToolset> | undefined;

export function getWhatsAppToolset(): ReturnType<typeof createWhatsAppToolset> {
  if (cached) return cached;
  cached = createWhatsAppToolset({
    client: getClient(),
    wabaPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  });
  return cached;
}
```

In your `app/api/mcp/route.ts`, route by tool-name prefix:

```ts
case "tools/call": {
  const params = body.params as { name: string; arguments: unknown };
  if (params.name.startsWith("whatsapp_")) {
    return ok(await getWhatsAppToolset().dispatch(params.name, params.arguments));
  }
  if (params.name.startsWith("alegra_")) { /* ... */ }
  return notFound(`Tool ${params.name} not registered`);
}
```

This uses **the same `WhatsAppClient` instance** as your
outbound code at § 5 — so a `whatsapp_send_text` tool call goes
through the same rate limiter, the same window tracker, the
same OTel spans, the same retry policy. There's exactly one
window-state source of truth and one Meta-credentials boundary.

## 7. Observability

OTel via `withSpan` is opt-in — register a tracer at module
init and the SDK's spans flow to your backend automatically.
For Vercel + a Sentry-style exporter, see
[`docs/sdk/observability.md`](../../sdk/observability.md) (the
Phase-B walkthrough lands when we ship `sdk-v1.1.0`).

Until then, the SDK emits these spans on every send:

- `whatsapp.request` — the Graph API HTTP call.
- `whatsapp.queue.acquire` — when wrapped in `withRateLimit`.
- `whatsapp.webhook.dispatch` — per inbound handler invocation.

PII (`phone_number_id`, `waba_id`, recipient) is hashed via
`hashPhoneNumberId(value, redactSalt)` — set
`WHATSAPP_REDACT_SALT` per environment so spans correlate
within an environment but differ across environments.

## 8. Caveats

- **Cold starts.** Vercel serverless cold-start latency
  (~300-800 ms) lives on top of your webhook ack budget. Still
  comfortably under Meta's 30 s rule, but worth knowing for the
  `whatsapp.webhook.dispatch` latency you'll see in OTel.
- **Postgres connection pool size.** `pg`'s `Pool({ max })`
  caps concurrent connections per function instance. With
  Vercel's per-function concurrency model, set this low (3-5).
  Supabase pooler then multiplexes onto its own pool.
- **`waitUntil` budget.** Vercel kills the function at
  `maxDuration` regardless of `waitUntil`. Long-running
  handler chains (multiple LLM calls, big DB writes) need
  `export const maxDuration = 60;` (Hobby) or `300;` (Pro) at
  the top of `route.ts`.
- **Schema migration.** The `whatsapp.kv` table is per-WABA in
  practice; if you're multi-tenant, prefix keys by tenant id
  in your handler logic. The schema itself doesn't carry
  tenancy.

## See also

- [`docs/sdk/web.md`](../../sdk/web.md) — full web-adapter reference (Cloudflare Workers, Bun, Deno, Vercel).
- [`docs/sdk/storage.md`](../../sdk/storage.md) — full storage reference; Redis / Postgres options.
- [`docs/cookbook/mcp/embedded-toolset.md`](../mcp/embedded-toolset.md) — full embedded-toolset gateway recipe.
- [`docs/cookbook/sdk/outbound-only.md`](../sdk/outbound-only.md) — when another library owns inbound.
