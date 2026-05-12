# Cookbook — Outbound-only mode

Use when another library or framework owns inbound webhooks
(Vercel Chat SDK, a hand-written receiver, a SaaS) and you want
Dojo's SDK to drive **outbound only** without setting up its
`WebhookReceiver`.

## When this pattern is right

- **Coexistence with Chat SDK or similar** — Chat SDK owns the
  webhook route and the inbound event pipeline. You want
  Dojo's `WhatsAppClient` for outbound sends because it gives
  you typed errors, retry/jitter, OTel spans, and the
  template-builder ergonomics — without re-doing inbound.
- **Queue workers** — your inbound flow lives elsewhere
  (Kafka, SQS, a separate process) and the worker only needs to
  send.
- **HITL operator UIs** — internal tools that send on demand;
  there's no webhook to handle.

## The setup

`WhatsAppClient` is **send-only by default.** The receiver is a
sibling primitive (`WebhookReceiver`) that consumers wire
themselves. Don't construct one if you don't need one.

```ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
});

await client.sendText({ to: "+5210000000001", body: "hello" });
```

That's it. No `WebhookReceiver`, no Express adapter, no
`WindowTracker`. The client sends.

## The 24-hour window question

`WhatsAppClient` has an **optional** `windowTracker`. When you
don't supply one, free-form sends are not gated — the client
issues the HTTP request directly. Meta will reject the send
with code `131026` if the customer's 24-hour window is closed
(the SDK maps this to `WindowClosedError`).

For **outbound-only mode you have three options**, in
increasing complexity:

### Option 1 — Don't gate; let Meta enforce

Skip `windowTracker` entirely. Send-tools attempt the HTTP
call; closed-window recipients fail with `WindowClosedError`.
Catch and retry with `sendTemplate`:

```ts
import { WhatsAppClient, WindowClosedError } from "@dojocoding/whatsapp-sdk";

try {
  await client.sendText({ to, body });
} catch (err) {
  if (err instanceof WindowClosedError) {
    await client.sendTemplate({ to, name: "hello_world", language: "en_US" });
  } else {
    throw err;
  }
}
```

**Pros:** zero state to track; reliable because Meta is the
source of truth.

**Cons:** every closed-window send burns one round-trip to Meta
before failing. Latency penalty and quota cost. Fine for
low-volume / interactive flows; not ideal for batch broadcasts.

### Option 2 — External signal, no Dojo `WindowTracker`

Your inbound owner (Chat SDK, your custom webhook) already
knows when the window is open. Surface that information to your
send path through your own state — a row on your `conversations`
table, a Redis key, a feature flag.

```ts
async function sendWithWindowGate(to: string, body: string) {
  const isOpen = await yourInbound.isWindowOpen(to);
  if (isOpen) {
    return client.sendText({ to, body });
  }
  return client.sendTemplate({ to, name: "hello_world", language: "en_US" });
}
```

**Pros:** no double-implementation of window-tracking;
single source of truth lives where inbound lives.

**Cons:** you write the gate yourself. Easy to forget when
adding a new send call site.

### Option 3 — Wire Dojo's `WindowTracker` with external `notifyInbound`

You can construct a `WindowTracker` and feed it from your
non-Dojo inbound path:

```ts
import { InMemoryStorage, WhatsAppClient, WindowTracker } from "@dojocoding/whatsapp-sdk";

const tracker = new WindowTracker({
  storage: new InMemoryStorage(), // or Redis / Postgres
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
});

const client = new WhatsAppClient({
  // ...credentials...
  windowTracker: tracker,
});

// In your Chat SDK / custom webhook receiver:
chatSdk.on("inbound", async (msg) => {
  await tracker.notifyInbound(msg.from);
  // ...do whatever else you do with inbound
});

// Now your send path is gated client-side:
await client.sendText({ to, body }); // throws WindowClosedError when closed
```

**Pros:** typed `WindowClosedError` pre-flights every send; no
wasted Meta round-trips; the SDK's tracker has a TTL contract
matching Meta's 24h window.

**Cons:** two storages to maintain (yours + Dojo's tracker),
unless you wrap one in a `Storage` adapter.

## Foot-gun avoidance

- **Don't construct a `WebhookReceiver` if you're not using
  it.** Calling `new WebhookReceiver({...})` registers nothing
  on its own, but it costs noise in your service-init code and
  can confuse the next reader into thinking the SDK is
  receiving when it isn't.
- **Don't wire Dojo's Express / web / Hono adapter unless you
  want Dojo to handle the webhook route.** Those adapters are
  thin shims over the receiver. Pulling them in implies the
  receiver is hot.
- **OTel spans still emit on the send path.** If you're using
  the SDK outbound-only, the `whatsapp.request` span still
  fires on every Graph API call. Configure your exporter once
  at boot.

## See also

- [`docs/sdk/client.md`](../../sdk/client.md) — full `WhatsAppClient` reference.
- [`docs/sdk/window.md`](../../sdk/window.md) — `WindowTracker` reference.
- [`docs/cookbook/coexistence/vercel-chat-sdk.md`](../coexistence/vercel-chat-sdk.md) — the canonical Chat-SDK coexistence pattern (Phase B).
