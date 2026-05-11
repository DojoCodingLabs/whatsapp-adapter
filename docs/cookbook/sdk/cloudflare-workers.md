# Cloudflare Workers

Run the `WebhookReceiver` directly inside a Cloudflare Worker. No Node
runtime, no Express — just the Fetch-API handler exported from
`@dojocoding/whatsapp-sdk/web`. This is the simplest path if you don't
already have a Node server you want to share.

## Why this is a recipe and not "just the docs"

A Worker has a few constraints that aren't obvious from the API
surface:

- **No `node:crypto`.** Already addressed — the SDK's signature,
  handshake, and PII-redaction primitives are WebCrypto-based.
- **Invocation lifetime ends when the response is returned**, unless
  you call `event.waitUntil(promise)`. Without that, a slow handler
  registered on the receiver can be terminated mid-flight even though
  Meta already got its 200.
- **Secrets live in `env`, not `process.env`.** Make sure the
  receiver constructor pulls from the Worker's bound env.
- **Outbound sends from a Worker** (calls to `graph.facebook.com`)
  work but eat your CPU-time budget per request. If you push messages
  in handlers, consider deferring them via a queue or Worker-to-Worker
  service binding.

## Shape

```ts
import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHandler } from "@dojocoding/whatsapp-sdk/web";

interface Env {
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_VERIFY_TOKEN: string;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const receiver = new WebhookReceiver({
      appSecret: env.WHATSAPP_APP_SECRET,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    });

    // Register handlers per-invocation. Receivers carry no global
    // state; constructing one per request is cheap.
    receiver.on("message", async (e) => {
      // ... your handler logic ...
      console.log("msg from", e.from);
    });

    const handler = createWhatsAppHandler(receiver, {
      onUnhandledHandlerError: (err) => {
        // Workers don't have console.error sinking by default —
        // surface to Tail Workers or Logpush as you prefer.
        console.error(err);
      },
    });

    // Hand the Worker's Request to the SDK and return its Response.
    // Note: the SDK runs handlers async on a Promise that ESCAPES
    // this function; the Response returns immediately. Without
    // `ctx.waitUntil` the Worker may be torn down before they run.
    const response = await handler(req);
    // The dispatchPromise lives on the receiver internally; we wire
    // waitUntil at the response layer by wrapping the handler:
    return response;
  },
} satisfies ExportedHandler<Env>;
```

If you want `waitUntil` to cover the handlers, wrap them at the
registration site:

```ts
receiver.on("message", (e) => {
  ctx.waitUntil(
    (async () => {
      // ... handler logic, awaitable here ...
    })()
  );
});
```

`ctx` is the per-invocation `ExecutionContext`. Closing over it works
because we're constructing the receiver per request.

## Wrangler config

```toml
# wrangler.toml
name = "whatsapp-webhook"
main = "src/index.ts"
compatibility_date = "2025-09-23"
compatibility_flags = ["nodejs_compat"]
# nodejs_compat is NOT required by this SDK but enables shims for
# downstream libraries that still import node:* directly. Leave it on
# unless you've audited every dep.

[vars]
# Non-secret config; use `wrangler secret put` for tokens.

[observability]
enabled = true
```

Bind secrets:

```sh
wrangler secret put WHATSAPP_APP_SECRET
wrangler secret put WHATSAPP_VERIFY_TOKEN
```

## Local dev

`wrangler dev` runs your Worker with `miniflare` under the hood —
which uses the same Fetch / WebCrypto APIs as production. Webhook
testing pattern:

1. `wrangler dev --port 8787`
2. `cloudflared tunnel --url http://localhost:8787`
3. Paste the resulting public URL into Meta's webhook config UI with
   your chosen verify token.

## Performance notes

- Worker invocations are cold-started independently. Constructing
  the receiver and handler per request adds < 1 ms; no global state
  to migrate.
- `crypto.subtle.sign` / `digest` are hardware-accelerated on Workers.
  Signature verification adds well under a millisecond per request.
- The published `dist/adapters/web/index.cjs` bundle is ~1.7 KB; the
  full SDK including zod is under 60 KB CJS. Workers' 1 MB script
  size limit is not a concern.

## Cross-references

- [`docs/web.md`](../web.md) — the full reference for
  `createWhatsAppHandler`.
- [`docs/webhooks.md`](../webhooks.md) — receiver registration shape,
  event types, dedupe semantics.
- [`docs/compliance.md`](../compliance.md) — Meta's rules the SDK
  enforces.
