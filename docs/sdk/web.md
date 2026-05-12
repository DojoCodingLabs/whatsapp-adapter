# Web adapter (`framework-adapters`)

The web-standard (Fetch-API) sub-module published at
`@dojocoding/whatsapp-sdk/web`. Returns a function that takes a `Request`
and resolves to a `Response` — usable as a Cloudflare Workers `fetch`
handler, a Hono / Next.js App Router route handler, a Bun `Bun.serve`
handler, a Deno serve handler, or anywhere else that speaks the Fetch
API. The Express adapter
([`docs/express.md`](./express.md)) is a thin shim over this same
core; if you're starting fresh on Node, either subpath works — pick
Express for ecosystem familiarity, web for portability.

Spec: [`openspec/specs/framework-adapters/spec.md`](../openspec/specs/framework-adapters/spec.md).
Source: [`packages/whatsapp-sdk/src/adapters/web/index.ts`](../src/adapters/web/index.ts).

## Public exports

```ts
import {
  createWhatsAppHandler,
  type CreateWhatsAppHandlerOptions,
  type WhatsAppHandler,
} from "@dojocoding/whatsapp-sdk/web";
```

Note the sub-module path: `@dojocoding/whatsapp-sdk/web`, not the root
import.

## What `createWhatsAppHandler` does

Given a configured `WebhookReceiver`, it returns
`(req: Request) => Promise<Response>`:

- `GET` → calls `receiver.handleVerifyRequest(...)` with query-string
  parameters parsed via `new URL(req.url).searchParams`. Returns
  `200 text/plain` with the challenge body on a valid handshake,
  `403` otherwise.
- `POST` → reads raw bytes via `req.arrayBuffer()` exactly once, hands
  them to `receiver.handlePayload(rawBody, signatureHeader, parsedBody)`,
  and returns `200` or `401` immediately. Handlers run asynchronously
  on the returned `dispatchPromise` so the 30-second-ack rule is
  respected even for slow handlers.
- any other method → `405 Method Not Allowed` with `Allow: GET, POST`.

The same raw bytes used for HMAC verification are also used as the
input to `JSON.parse` — never `req.json()` directly. Some Fetch
implementations re-serialise JSON on round-trip, which would break
signature verification.

## Cloudflare Workers

```ts
import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHandler } from "@dojocoding/whatsapp-sdk/web";

const receiver = new WebhookReceiver({
  appSecret: globalThis.WHATSAPP_APP_SECRET as string,
  verifyToken: globalThis.WHATSAPP_VERIFY_TOKEN as string,
});
receiver.on("message", async (e) => {
  console.log("message from", e.from);
});

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const handler = createWhatsAppHandler(receiver, {
      waitUntil: ctx.waitUntil.bind(ctx),
    });
    return handler(req);
  },
};
```

**`waitUntil` is required on Workers.** Without it, the Worker
terminates the moment the `Response` returns and your async
handlers — DB writes, follow-up sends, OTel exports — get dropped
silently. The pattern above wires `ctx.waitUntil` so the runtime
awaits the dispatch promise within its function budget.

## Bun

```ts
import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHandler } from "@dojocoding/whatsapp-sdk/web";

const receiver = new WebhookReceiver({
  appSecret: Bun.env.WHATSAPP_APP_SECRET!,
  verifyToken: Bun.env.WHATSAPP_VERIFY_TOKEN!,
});
const handler = createWhatsAppHandler(receiver);

Bun.serve({
  port: 3000,
  fetch: handler,
});
```

## Hono

For Hono apps, use the dedicated [`@dojocoding/whatsapp-sdk/hono`](./hono.md)
subpath instead — `whatsappHandler(receiver)` returns a typed Hono
`Handler` directly. The web core works via `app.all(path, (c) =>
handler(c.req.raw))` if you'd rather not pull the subpath, but the
dedicated wrapper is what we recommend.

## Next.js App Router (Vercel)

```ts
// app/api/webhooks/whatsapp/route.ts
import { waitUntil } from "@vercel/functions";

import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHandler } from "@dojocoding/whatsapp-sdk/web";

export const runtime = "nodejs"; // pg, ioredis, and most SDK consumers need Node
export const dynamic = "force-dynamic"; // webhooks are POST; bypass static optimisation

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});
const handler = createWhatsAppHandler(receiver, { waitUntil });

export const GET = handler;
export const POST = handler;
```

**`waitUntil` is required on Vercel serverless.** Without it, the
function dies the instant `Response` returns and the SDK's async
dispatch is silently dropped — your handlers never finish, DB
writes never land, OTel spans never flush. Wiring
`@vercel/functions`'s `waitUntil` extends the invocation lifecycle
long enough for the dispatch promise to resolve (within
`maxDuration` — 60 s on Hobby, 300 s on Pro).

Next.js auto-passes the `Request` to the handler and treats the
returned `Response` as the HTTP response — no glue required beyond
the `waitUntil` wiring.

## Options

```ts
const handler = createWhatsAppHandler(receiver, {
  // Invoked when an exception escapes a registered handler's
  // dispatchPromise. Defaults to `console.error`.
  onUnhandledHandlerError: (err) => myLogger.error(err),

  // Lifecycle extension for serverless / edge runtimes that kill
  // the function after the Response. REQUIRED on Vercel Functions
  // and Cloudflare Workers; omit on long-lived Node / Bun / Deno
  // servers.
  waitUntil: vercelOrCloudflareWaitUntil,
});
```

## Threading model

- The returned `Response` is awaited by the runtime BEFORE handlers
  finish — that's the whole point of the
  `dispatchPromise.catch(onUnhandledHandlerError)` pattern.
- **Long-lived runtimes** (Node / Bun / Deno standalone servers):
  fire-and-forget works. The dispatch promise lives on the event
  loop until handlers complete. Omit `waitUntil`.
- **Serverless / edge runtimes** (Vercel Functions, Cloudflare
  Workers, AWS Lambda): the function dies after the response and
  the promise is dropped. Supply `waitUntil` so the runtime
  extends the invocation within its function-budget lifecycle.
- The adapter wraps the dispatch promise in
  `.catch(onUnhandledHandlerError)` BEFORE handing it to
  `waitUntil`, so the runtime never sees an unhandled rejection.
