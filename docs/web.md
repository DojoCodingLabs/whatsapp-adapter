# Web adapter (`framework-adapters`)

The web-standard (Fetch-API) sub-module published at
`@dojocoding/whatsapp/web`. Returns a function that takes a `Request`
and resolves to a `Response` — usable as a Cloudflare Workers `fetch`
handler, a Hono / Next.js App Router route handler, a Bun `Bun.serve`
handler, a Deno serve handler, or anywhere else that speaks the Fetch
API. The Express adapter
([`docs/express.md`](./express.md)) is a thin shim over this same
core; if you're starting fresh on Node, either subpath works — pick
Express for ecosystem familiarity, web for portability.

Spec: [`openspec/specs/framework-adapters/spec.md`](../openspec/specs/framework-adapters/spec.md).
Source: [`src/adapters/web/index.ts`](../src/adapters/web/index.ts).

## Public exports

```ts
import {
  createWhatsAppHandler,
  type CreateWhatsAppHandlerOptions,
  type WhatsAppHandler,
} from "@dojocoding/whatsapp/web";
```

Note the sub-module path: `@dojocoding/whatsapp/web`, not the root
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
import { WebhookReceiver } from "@dojocoding/whatsapp";
import { createWhatsAppHandler } from "@dojocoding/whatsapp/web";

const receiver = new WebhookReceiver({
  appSecret: globalThis.WHATSAPP_APP_SECRET as string,
  verifyToken: globalThis.WHATSAPP_VERIFY_TOKEN as string,
});
receiver.on("message", async (e) => {
  console.log("message from", e.from);
});

const handler = createWhatsAppHandler(receiver);

export default {
  async fetch(req: Request): Promise<Response> {
    return handler(req);
  },
};
```

`waitUntil` is optional but recommended in Workers if you want
guarantees that long-running handlers finish even after the response
is sent. Pass an `onUnhandledHandlerError` option that logs to your
preferred sink.

## Bun

```ts
import { WebhookReceiver } from "@dojocoding/whatsapp";
import { createWhatsAppHandler } from "@dojocoding/whatsapp/web";

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

```ts
import { Hono } from "hono";
import { WebhookReceiver } from "@dojocoding/whatsapp";
import { createWhatsAppHandler } from "@dojocoding/whatsapp/web";

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});
const handler = createWhatsAppHandler(receiver);

const app = new Hono();
app.all("/webhooks/whatsapp", (c) => handler(c.req.raw));
```

A dedicated `@dojocoding/whatsapp/hono` subpath is on the roadmap for
nicer ergonomics; the snippet above is fully functional today.

## Next.js App Router

```ts
// app/api/webhooks/whatsapp/route.ts
import { WebhookReceiver } from "@dojocoding/whatsapp";
import { createWhatsAppHandler } from "@dojocoding/whatsapp/web";

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});
const handler = createWhatsAppHandler(receiver);

export const GET = handler;
export const POST = handler;
```

Next.js automatically passes the `Request` to the handler and treats
the returned `Response` as the HTTP response — no glue required.

## Options

```ts
const handler = createWhatsAppHandler(receiver, {
  // Invoked when an exception escapes a registered handler's
  // dispatchPromise. Defaults to `console.error`.
  onUnhandledHandlerError: (err) => myLogger.error(err),
});
```

## Threading model

- The returned `Response` is awaited by the runtime BEFORE handlers
  finish — that's the whole point of the
  `dispatchPromise.catch(onUnhandledHandlerError)` pattern.
- For runtimes with `event.waitUntil`-style lifecycle extensions
  (Workers, Vercel Edge), wrap the call site so the runtime doesn't
  terminate the invocation before handlers resolve. The web core
  itself doesn't depend on any runtime-specific primitive.
