# Hono + Cloudflare Workers

Run the SDK on a Worker fronted by Hono. This is the recipe for a
deployment that's currently or eventually multi-route — a single
Worker hosting your webhook endpoint alongside other API routes.
If your Worker is WhatsApp-only, see
[`./cloudflare-workers.md`](./cloudflare-workers.md) for a leaner
shape; if you're not on Workers, the Hono setup still works on Bun
or Deno without changes.

## Why this recipe

- Hono is the idiomatic routing layer on Workers, Bun, and Deno.
  Most production WinterCG deployments end up using it.
- The pattern below puts the WhatsApp receiver inside a route
  handler so other routes don't share its construction cost.
- Co-located outbound logic (sending replies, calling other APIs)
  works without crossing module boundaries.

## Full shape

```ts
import { Hono } from "hono";
import { WhatsAppClient, WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { whatsappHandler } from "@dojocoding/whatsapp-sdk/hono";

interface Env {
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_WABA_ID: string;
  WHATSAPP_TOKEN: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.text("ok"));

app.all("/webhooks/whatsapp", async (c) => {
  const receiver = new WebhookReceiver({
    appSecret: c.env.WHATSAPP_APP_SECRET,
    verifyToken: c.env.WHATSAPP_VERIFY_TOKEN,
  });
  const client = new WhatsAppClient({
    phoneNumberId: c.env.WHATSAPP_PHONE_NUMBER_ID,
    wabaId: c.env.WHATSAPP_WABA_ID,
    token: c.env.WHATSAPP_TOKEN,
    appSecret: c.env.WHATSAPP_APP_SECRET,
  });

  receiver.on("message", async (event) => {
    if (event.type === "text") {
      const body = String((event.body as { text?: { body?: string } }).text?.body ?? "");
      if (body.toLowerCase().includes("hello")) {
        await client.sendText({ to: event.from, body: "Hi 👋" });
      }
    }
  });

  return whatsappHandler(receiver)(c);
});

export default app;
```

## Wrangler config

```toml
# wrangler.toml
name = "whatsapp-hono"
main = "src/index.ts"
compatibility_date = "2025-09-23"

[observability]
enabled = true
```

Bind secrets:

```sh
wrangler secret put WHATSAPP_APP_SECRET
wrangler secret put WHATSAPP_VERIFY_TOKEN
wrangler secret put WHATSAPP_PHONE_NUMBER_ID
wrangler secret put WHATSAPP_WABA_ID
wrangler secret put WHATSAPP_TOKEN
```

Run locally with `wrangler dev`; tunnel a public URL with
`cloudflared tunnel --url http://localhost:8787` and paste it into
Meta's webhook UI.

## Per-request construction is fine

Workers cold-start per invocation. Constructing a `WebhookReceiver`
and `WhatsAppClient` inside the route handler adds under a
millisecond total — both classes are pure constructors with no IO at
init time. Don't try to cache them at module scope; per-request scope
keeps secrets correctly bound and matches Workers' lifecycle.

If you're on Node or Bun, you can cache the construction at module
scope safely — the SDK has no global state. Use whichever pattern
matches your runtime.

## Handling the dispatch lifetime on Workers

Handlers registered on the receiver run asynchronously on a promise
that's NOT returned from the route handler. On Workers, that means
the invocation can be terminated before they finish unless wrapped
in `ctx.waitUntil`. To get that:

```ts
app.all("/webhooks/whatsapp", async (c) => {
  const receiver = new WebhookReceiver({ ... });
  receiver.on("message", (e) => {
    c.executionCtx.waitUntil(handle(e));
  });
  return whatsappHandler(receiver)(c);
});

async function handle(event: MessageEvent) {
  // ... long work here ...
}
```

`c.executionCtx` is Hono's accessor for the Worker `ExecutionContext`
on every request. Close over it in the registration so the lifetime
extension is bound to the right invocation.

## Outbound sends from inside a handler

WhatsApp Cloud API calls go to `graph.facebook.com`. On Workers,
that's a regular `fetch` from your Worker. It counts against your
CPU-time budget per request — if you're doing heavy lifting in the
handler, defer the send to a queue or service binding rather than
inlining it.

The `WhatsAppClient` itself works unmodified — it uses `globalThis.fetch`
which is Workers' built-in.

## Cross-references

- [`../hono.md`](../hono.md) — Hono adapter reference.
- [`../web.md`](../web.md) — underlying Fetch-API core.
- [`./cloudflare-workers.md`](./cloudflare-workers.md) — leaner
  WhatsApp-only Worker (no Hono layer).
- [`../compliance.md`](../compliance.md) — Meta's rules the SDK
  enforces.
