# Quickstart

Five minutes from `pnpm install` to a sent message and a working webhook
endpoint. Each block is a complete file you can save and run.

## Prerequisites

- A WhatsApp Business Account (WABA) with at least one approved
  phone number.
- A long-lived bearer token (System User or BISU) with the
  `whatsapp_business_messaging` and `whatsapp_business_management`
  scopes.
- The Meta App's App Secret.
- A public HTTPS endpoint for webhooks (use ngrok / cloudflared in
  development).

You can skip all of the above and run against `WHATSAPP_MODE=mock` (see
[Step 4](#4-run-against-the-mock-without-meta-credentials)).

## 1. Install

```bash
pnpm add @dojocoding/whatsapp-sdk
# pnpm add @opentelemetry/api    # only if you want OTel spans (peer dep)
```

This SDK targets Node ≥ 20. ESM and CJS are both supported.

## 2. Send your first message

Save as `send.ts`:

```ts
import "dotenv/config";
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  token: process.env.WHATSAPP_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
});

const res = await client.sendText({
  to: process.argv[2] ?? "", // E.164-style customer wa_id
  body: "Hi from @dojocoding/whatsapp-sdk 👋",
});

console.log("sent", res.messages[0].id); // wamid.HBgM…
```

Run it:

```bash
node --env-file=.env --experimental-strip-types send.ts 521234567890
```

If you don't have a `.env` yet, copy [`.env.example`](../.env.example) and
fill in the four required values.

## 3. Receive webhooks

Pick your runtime:

- **Next.js App Router on Vercel** → see [§ 3a](#3a-nextjs-app-router-vercel) below.
- **Express on a long-lived Node server** → see [§ 3b](#3b-express).
- **Cloudflare Workers, Bun, Deno, Hono** → see [`docs/sdk/web.md`](./web.md) and [`docs/sdk/hono.md`](./hono.md).

The receiver primitive (`WebhookReceiver`) is the same in every
runtime; the per-runtime adapter is a thin shim that wires
raw-bytes capture + the `Request → Response` shape.

### 3a. Next.js App Router (Vercel)

The shortest path for teams already on Vercel. Lives in your
existing app under `app/api/webhooks/whatsapp/route.ts`:

```ts
// app/api/webhooks/whatsapp/route.ts
import { waitUntil } from "@vercel/functions";

import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHandler } from "@dojocoding/whatsapp-sdk/web";

export const runtime = "nodejs"; // pg / ioredis / most SDK consumers need Node
export const dynamic = "force-dynamic";

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});

receiver.on("message", async (e) => {
  console.log("incoming", e.type, "from", e.from, "wamid", e.id);
});

const handler = createWhatsAppHandler(receiver, { waitUntil });

export const GET = handler;
export const POST = handler;
```

**`waitUntil` is required on Vercel serverless.** Without it,
the function dies the moment `Response` returns and the SDK's
async dispatch is silently dropped. Wiring
`@vercel/functions`'s `waitUntil` extends the invocation
lifecycle long enough for the dispatch promise to resolve
(within your `maxDuration` budget — 60 s on Hobby, 300 s on
Pro).

Same Meta-side setup as the Express path below — set the
callback URL to your Vercel deploy + `/api/webhooks/whatsapp`,
set the verify token, subscribe to `messages`.

For the full Site2Print-shape recipe (Next.js + Supabase
Postgres for shared `WindowTracker` state + the SDK +
optionally the MCP toolset), see
[`docs/cookbook/integrations/next-app-router-supabase.md`](../cookbook/integrations/next-app-router-supabase.md).

### 3b. Express

Save as `webhook.ts`:

```ts
import "dotenv/config";
import express from "express";
import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppMiddleware } from "@dojocoding/whatsapp-sdk/express";

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});

receiver.on("message", async (e) => {
  console.log("incoming", e.type, "from", e.from, "wamid", e.id);
});

receiver.on("status", (e) => {
  console.log("status", e.id, "→", e.status);
});

const app = express();
app.use("/webhooks/whatsapp", createWhatsAppMiddleware(receiver));
//                              ^ register BEFORE any global express.json()

app.listen(3000, () => console.log("listening on :3000"));
```

Expose it (in another terminal):

```bash
ngrok http 3000
# → https://abc123.ngrok.app
```

Configure the webhook in Meta's app dashboard:

1. **Callback URL:** `https://abc123.ngrok.app/webhooks/whatsapp`
2. **Verify token:** the value of `WHATSAPP_VERIFY_TOKEN`
3. Subscribe to the `messages` field (and any other fields you want —
   `message_template_status_update`, `phone_number_quality_update`, etc.).

Meta will send a `GET` to verify; the middleware echoes the challenge.
Then send a WhatsApp message to your business number — your handler runs.

## 4. Wire the 24-hour customer-service window

Most production senders need this. The pattern is two lines:

```ts
import { WindowTracker, InMemoryStorage } from "@dojocoding/whatsapp-sdk";

const tracker = new WindowTracker({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  storage: new InMemoryStorage(),
});

// (1) Pass the tracker to the client:
const client = new WhatsAppClient({
  phoneNumberId,
  wabaId,
  token,
  appSecret,
  windowTracker: tracker,
});

// (2) Notify the tracker from your message handler:
receiver.on("message", (e) => tracker.notifyInbound(e.from));
```

Now `client.sendText(...)` throws `WindowClosedError` synchronously when
the recipient's window is closed — _before_ any HTTP call. Templates and
reactions remain window-exempt.

```ts
import { WindowClosedError } from "@dojocoding/whatsapp-sdk";

try {
  await client.sendText({ to, body: "Hi!" });
} catch (err) {
  if (err instanceof WindowClosedError) {
    await client.sendTemplate({
      to,
      name: "appointment_reminder",
      language: "en_US",
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: "Daniel" }],
        },
      ],
    });
  }
}
```

For multi-process deployments, swap `InMemoryStorage` for a Redis-backed
implementation of the `Storage` interface. See
[`window.md`](./window.md#storage-backends).

## 5. Run against the mock (without Meta credentials)

For tests, CI, or local-only development:

```bash
WHATSAPP_MODE=mock node --env-file=.env send.ts
```

`pickWhatsAppClient(...)` returns a `MockWhatsAppClient` when
`WHATSAPP_MODE=mock` is set. It records every send to memory, generates
deterministic `wamid.mock-N` ids, and never touches the network.

```ts
import { pickWhatsAppClient, MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";

const client = pickWhatsAppClient({
  phoneNumberId: "PHONE_ID",
  wabaId: "WABA_ID",
  token: "", // unused in mock mode
  appSecret: "", // unused in mock mode
});

await client.sendText({ to: "521234567890", body: "hi" });

if (client instanceof MockWhatsAppClient) {
  console.log(client.sentMessages);
  // [{ wamid: "wamid.mock-1", payload: {...}, sentAt: 1735689600000 }]
}
```

See [`mock.md`](./mock.md) for parity guarantees and the
`simulateInbound` helper for inbound testing.

## 6. Add observability (optional)

Register a global OTel `TracerProvider` once at boot and you'll
automatically get `whatsapp.request` and `whatsapp.webhook.dispatch`
spans for every Graph call and every webhook dispatch. See
[`observability.md`](./observability.md) for a minimal setup.

Set the redact salt once at boot in production:

```ts
import { setRedactSalt } from "@dojocoding/whatsapp-sdk";
setRedactSalt(process.env.WHATSAPP_REDACT_SALT ?? "frontdesk:prod");
```

Phone-number ids on spans are hashed; the wamid is kept raw for
correlation with application-side logs.

## What to read next

- **Per-capability docs:** [`client.md`](./client.md),
  [`messages.md`](./messages.md), [`webhooks.md`](./webhooks.md),
  [`window.md`](./window.md), [`templates.md`](./templates.md),
  [`mock.md`](./mock.md), [`observability.md`](./observability.md),
  [`express.md`](./express.md).
- **Compliance & policy:** [`compliance.md`](./compliance.md) — the
  rules this SDK enforces, the rules you must enforce, and the current
  divergences from latest Meta guidance.
- **Architecture:** [`architecture.md`](./architecture.md) — how the
  eight capabilities fit together.
- **Comparison with alternatives:** [`compatibility.md`](./compatibility.md).
