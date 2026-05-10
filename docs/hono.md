# Hono adapter (`framework-adapters`)

A typed Hono wrapper around the web-standard core, published at
`@dojocoding/whatsapp/hono`. Use this when your service runs on
Hono — typically on Cloudflare Workers, Bun, Deno, or any
WinterCG-compliant runtime where Hono is the routing layer.

The entire wrapper is a one-line delegation to
[`createWhatsAppHandler`](./web.md). If you're not already on Hono,
read [`docs/web.md`](./web.md) first; this page is for consumers
who want the Hono-flavoured ergonomics.

Spec: [`openspec/specs/framework-adapters/spec.md`](../openspec/specs/framework-adapters/spec.md).
Source: [`src/adapters/hono/index.ts`](../src/adapters/hono/index.ts).

## Public exports

```ts
import { whatsappHandler, type WhatsAppHonoHandlerOptions } from "@dojocoding/whatsapp/hono";
```

The options type is an alias for `CreateWhatsAppHandlerOptions` from
the web core — same shape, single source of truth.

## Mounting

```ts
import { Hono } from "hono";
import { WebhookReceiver } from "@dojocoding/whatsapp";
import { whatsappHandler } from "@dojocoding/whatsapp/hono";

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});
receiver.on("message", async (e) => {
  console.log("msg from", e.from);
});

const app = new Hono();
app.all("/webhooks/whatsapp", whatsappHandler(receiver));
```

`app.all` is the right verb — the handler itself decides GET vs POST
based on the request method, and returns 405 for anything else. Don't
use `app.get + app.post` separately; you'll lose the 405 semantic on
PUT / DELETE / PATCH.

## Options

```ts
const handler = whatsappHandler(receiver, {
  onUnhandledHandlerError: (err) => logger.error(err),
});
```

`onUnhandledHandlerError` fires when an exception escapes a
registered handler's `dispatchPromise` — after the 200 ack has
already been sent. Default is `console.error`.

## What the wrapper does (and doesn't do)

It's a closure over
[`createWhatsAppHandler(receiver, options)`](./web.md) that unwraps
Hono's `c.req.raw` (already a Fetch-API `Request`) and returns the
`Response` Hono expects. Everything else — handshake verification,
HMAC signature check, 30-second ack rule, dedupe, dispatch — lives
in the web core. Reading [`docs/web.md`](./web.md) is the fastest
way to understand the semantics.

The wrapper does NOT:

- Compose with other Hono middlewares automatically — mount the
  WhatsApp endpoint on its own path.
- Provide Zod-validator or RPC integration — those layer at the
  consumer's discretion.
- Mount under multiple paths from one factory call — call
  `whatsappHandler(receiver)` once and mount the result wherever
  you want.

## Cloudflare Workers + Hono

```ts
import { Hono } from "hono";
import { WebhookReceiver } from "@dojocoding/whatsapp";
import { whatsappHandler } from "@dojocoding/whatsapp/hono";

interface Env {
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_VERIFY_TOKEN: string;
}

const app = new Hono<{ Bindings: Env }>();

app.all("/webhooks/whatsapp", (c) => {
  const receiver = new WebhookReceiver({
    appSecret: c.env.WHATSAPP_APP_SECRET,
    verifyToken: c.env.WHATSAPP_VERIFY_TOKEN,
  });
  receiver.on("message", async (e) => {
    // ... handler ...
  });
  return whatsappHandler(receiver)(c);
});

export default app;
```

If your Worker handles other routes too, this is the cleaner pattern
— construct the receiver inside the route handler so other routes
don't carry the WebhookReceiver overhead. For a Worker that's
WhatsApp-only,
[`docs/cookbook/cloudflare-workers.md`](./cookbook/cloudflare-workers.md)
shows the leaner shape.

## Threading model

Same as the web core:

- The Hono `Handler` returns a `Response` BEFORE the
  `dispatchPromise` resolves. Handlers run asynchronously on a
  promise the wrapper does not return.
- On runtimes with `ctx.waitUntil` (Workers, Vercel Edge), wrap your
  registered handlers in `ctx.waitUntil(...)` so the runtime doesn't
  terminate the invocation before they finish — closure-capture
  `ctx` at registration time.
- On Node + Bun + Deno, the event loop keeps running until the
  process exits; no special handling needed.

## Hono version range

Peer dependency: `hono: ^4.0.0`. The adapter uses only `c.req.raw`,
which has been stable since Hono v3, so the range is conservative.
If you're on Hono 5+, file an issue and we'll widen the peer.

## Cross-references

- [`docs/web.md`](./web.md) — full reference for the underlying
  `createWhatsAppHandler`. Every semantic the Hono adapter inherits
  is documented there.
- [`docs/cookbook/hono.md`](./cookbook/hono.md) — end-to-end Hono
  recipe with a real send/receive flow.
- [`docs/webhooks.md`](./webhooks.md) — receiver registration shape,
  event types, dedupe semantics.
