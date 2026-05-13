# Cookbook — Coexisting with Vercel Chat SDK

Run `@dojocoding/whatsapp-sdk` alongside `@chat-adapter/whatsapp`
(or any other library that owns inbound webhooks) without
fighting over the webhook route or duplicating consent /
window state.

The pattern: **Chat SDK owns inbound; Dojo SDK is outbound-only.**
Dojo's `WhatsAppClient` for sends, Chat SDK for receives,
shared state through your own DB.

## Why this pattern

The Vercel Chat SDK is purpose-built for agentic chat loops —
threads, message replay, tool calls, streaming. Replacing it
mid-development to switch to Dojo's `WebhookReceiver` rips out
the agent layer that's already shipped.

Dojo's `WhatsAppClient` is purpose-built for outbound sends —
typed errors, retry/jitter, OTel spans, the consent registry,
template builders. Re-implementing all that inside the Chat
SDK costs a week.

Coexistence: keep Chat SDK's agent layer, use Dojo's client
for the outbound side. One webhook route, one agent, two
libraries.

## What each side owns

| Concern                                         | Owner                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS endpoint receiving Meta webhooks          | **Chat SDK**                                                                                                                       |
| HMAC signature verification                     | **Chat SDK**                                                                                                                       |
| Inbound event parsing + dispatch to the agent   | **Chat SDK**                                                                                                                       |
| Agent loop (LLM calls, tool dispatch)           | **Chat SDK**                                                                                                                       |
| Outbound `sendText` / `sendTemplate` / etc.     | **Dojo SDK**                                                                                                                       |
| Typed error handling on outbound                | **Dojo SDK**                                                                                                                       |
| 24h window state                                | **Your DB** (fed by Chat SDK's inbound, consumed by Dojo's `WindowTracker` configured against the same storage)                    |
| Consent / opt-in state                          | **Your DB** (fed by your STOP-keyword handler in Chat SDK, consumed by Dojo's `OptInRegistry` configured against the same storage) |
| Send status callbacks (sent / delivered / read) | **Chat SDK** (inbound side; surface to your own listener via Chat SDK's API)                                                       |

## The webhook route — Chat SDK only

```ts
// app/api/webhooks/whatsapp/route.ts  (Chat SDK owns this)
import { handler as chatSdkHandler } from "@chat-adapter/whatsapp/route";

export { chatSdkHandler as GET, chatSdkHandler as POST };
```

**Do NOT** also wire `createWhatsAppHandler` from
`@dojocoding/whatsapp-sdk/web` to this route. Two HMAC
verifiers running on the same body double-process the
signature (still correct — both succeed — but wasted CPU)
and double-dispatch handlers to two separate event
pipelines.

## Outbound — Dojo SDK only

```ts
// lib/whatsapp.ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";

let cached: WhatsAppClient | undefined;

export function getClient(): WhatsAppClient {
  if (cached) return cached;
  cached = new WhatsAppClient({
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
    token: process.env.WHATSAPP_ACCESS_TOKEN!,
    appSecret: process.env.WHATSAPP_APP_SECRET!,
  });
  return cached;
}
```

In your agent's tool implementations:

```ts
import { getClient } from "@/lib/whatsapp";

async function sendCustomerMessage(threadId: string, body: string) {
  const conv = await db.conversation.findById(threadId);
  const result = await getClient().sendText({ to: conv.recipient, body });
  return result.messages[0]?.id;
}
```

## Shared window state

The 24-hour customer-service window is the touchy bit.
Dojo's `WhatsAppClient` can pre-flight free-form sends against
a `WindowTracker` — but the tracker only knows about inbound
messages if something has called `tracker.notifyInbound(from)`.

Chat SDK owns inbound. Wire Chat SDK's inbound hook to feed
Dojo's tracker:

```ts
// lib/whatsapp.ts (continued)
import { InMemoryStorage, WindowTracker } from "@dojocoding/whatsapp-sdk";

import { getStorage } from "./storage"; // your Postgres / Redis wrapper

const tracker = new WindowTracker({
  storage: getStorage(), // SHARED with whatever Chat SDK uses for state
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
});

export function getClient(): WhatsAppClient {
  if (cached) return cached;
  cached = new WhatsAppClient({
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
    token: process.env.WHATSAPP_ACCESS_TOKEN!,
    appSecret: process.env.WHATSAPP_APP_SECRET!,
    windowTracker: tracker, // gates free-form sends
  });
  return cached;
}

export { tracker };
```

In Chat SDK's inbound hook (whatever the API is — it usually
exposes a `onMessage` / `events.on("message", ...)` shape):

```ts
chatSdk.events.on("message", async (msg) => {
  await tracker.notifyInbound(msg.from);
  // ...continue with Chat SDK's normal inbound flow
});
```

Now Dojo's `client.sendText(...)` pre-flights against the
same window state Chat SDK's inbound populates. One source
of truth.

### Alternative: don't gate; let Meta enforce

If you don't want to wire the tracker, skip it:

```ts
const client = new WhatsAppClient({
  // ...credentials...
  // no windowTracker
});
```

Then handle `WindowClosedError` in your send call site:

```ts
import { WindowClosedError } from "@dojocoding/whatsapp-sdk";

try {
  await client.sendText({ to, body });
} catch (err) {
  if (err instanceof WindowClosedError) {
    // Window closed at Meta's side → fall back to a template.
    await client.sendTemplate({ to, name: "follow_up", language: "es_MX" });
  } else {
    throw err;
  }
}
```

This pattern is documented in
[`docs/cookbook/sdk/outbound-only.md`](../sdk/outbound-only.md)
§ "Option 1 — Don't gate; let Meta enforce." Cheapest setup;
one wasted Meta round-trip per closed-window send.

## Shared opt-in / consent state

Same pattern. Wire your `OptInRegistry` against the same DB
Chat SDK uses. In your Chat SDK inbound handler, react to
STOP keywords:

```ts
import { InMemoryOptInRegistry } from "@dojocoding/whatsapp-sdk";

const registry = new InMemoryOptInRegistry();
// In production: replace with a Postgres-backed registry — see
// docs/cookbook/sdk/opt-in-postgres.md

const STOP_KEYWORDS = new Set(["STOP", "BAJA", "UNSUBSCRIBE"]);

chatSdk.events.on("message", async (msg) => {
  const text = (msg.body?.text?.body as string | undefined)?.toUpperCase().trim();
  if (text !== undefined && STOP_KEYWORDS.has(text)) {
    await registry.optOut(msg.from, { reason: `stop-keyword:${text}` });
  }
});

// And wire the registry into Dojo's client:
cached = new WhatsAppClient({
  // ...credentials...
  windowTracker: tracker,
  optInRegistry: registry, // gates template sends
});
```

## Status callbacks (sent / delivered / read)

Chat SDK receives Meta's status webhook events alongside
inbound messages. Your follow-up cadence (re-engagement
templates after read failures, retry on `failed` status) lives
on the Chat SDK side. Dojo's `WebhookReceiver.on("status", ...)`
is NOT used in this coexistence pattern — Chat SDK owns the
receive surface.

If you migrate to Dojo's webhook receiver later, the inbound
status pipeline ports over to `receiver.on("status", e => ...)`.
Until then, the status path is opaque to Dojo's SDK; this is
fine for outbound-only deployments.

## No double signature verification

Make sure only one library is verifying HMAC signatures on the
incoming webhook. Two verifiers running on the same raw bytes
both succeed (both have the same `WHATSAPP_APP_SECRET`) but
that's wasted CPU and confuses logging. Pick one — Chat SDK
in this pattern.

The Dojo SDK's `verifySignature` / `WebhookReceiver` aren't
invoked in this setup. Don't import them; don't construct
them.

## Foot-guns

- **Two webhook receivers.** Don't wire both Chat SDK's route
  AND Dojo's `createWhatsAppHandler` on the same path. One
  receives; the other doesn't see traffic and gets confused.
- **Two window trackers.** Two `WindowTracker` instances
  pointing at different storage diverge over time. Pick one
  storage; share the tracker (or construct two trackers
  against the same storage, which is fine).
- **Forgetting `notifyInbound`.** If Chat SDK's hook doesn't
  call `tracker.notifyInbound`, Dojo's client thinks every
  window is closed and rejects every free-form send. The
  recovery hint says "use a template" — but the real fix
  is to wire the hook.
- **OTel duplicate spans.** Chat SDK may emit its own
  outbound-send spans if it has them. Dojo's
  `whatsapp.request` span fires per Graph API call from Dojo's
  client. If you see duplicates, audit which library is
  making each Meta call and consolidate.

## Migrating off Chat SDK later

If you decide to rip out Chat SDK and have Dojo own
everything:

1. Wire `createWhatsAppHandler` (or the Express adapter) on
   the webhook route.
2. Replace the Chat SDK `events.on("message", ...)` hook with
   Dojo's `receiver.on("message", ...)`.
3. Replace any Chat SDK status-callback logic with
   `receiver.on("status", ...)`.
4. Remove the `tracker.notifyInbound` wiring — the receiver
   does it implicitly via the SDK's window-aware webhook
   plumbing (when the tracker is configured on the receiver).
5. Drop the `@chat-adapter/whatsapp` dependency.

Conversation history, thread state, and your agent layer
stay as-is.

## See also

- [`docs/cookbook/sdk/outbound-only.md`](../sdk/outbound-only.md)
  — three patterns for outbound-only deployments (the
  pre-flight options, window-state alternatives).
- [`docs/sdk/opt-in.md`](../../sdk/opt-in.md) § "Inbound
  opt-out keywords" — STOP-keyword handler pattern.
- [`docs/cookbook/integrations/next-app-router-supabase.md`](../integrations/next-app-router-supabase.md)
  — the Dojo-only Next.js + Supabase recipe (compare/contrast).
