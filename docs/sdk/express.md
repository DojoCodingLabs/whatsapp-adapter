# Express adapter (`framework-adapters`)

The Express middleware sub-module published at
`@dojocoding/whatsapp-sdk/express`. Mounts a `WebhookReceiver` against an
HTTP route and handles all the small details: raw-body capture for HMAC,
the verify-token GET handshake, the 30-second-ack rule, and 405 for
other verbs.

Spec: [`openspec/specs/framework-adapters/spec.md`](../openspec/specs/framework-adapters/spec.md).
Source: [`packages/whatsapp-sdk/src/adapters/express/index.ts`](../src/adapters/express/index.ts).

## Public exports

```ts
import {
  createWhatsAppMiddleware,
  type CreateWhatsAppMiddlewareOptions,
} from "@dojocoding/whatsapp-sdk/express";
```

Note the sub-module path: `@dojocoding/whatsapp-sdk/express`, not the root
import.

## Mounting

```ts
import express from "express";
import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppMiddleware } from "@dojocoding/whatsapp-sdk/express";

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});

receiver.on("message", async (e) => {
  console.log("from", e.from, "wamid", e.id);
});

const app = express();
app.use("/webhooks/whatsapp", createWhatsAppMiddleware(receiver));
//                              ^ register BEFORE any global express.json()
app.listen(3000);
```

Behaviour at the mount path:

| Method | What happens                                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | Handshake: returns `200 text/plain` with the echoed `hub.challenge` on success, `403` on bad token or wrong mode.                                                                 |
| `POST` | Verifies HMAC, parses, **acks 200 first**, then runs handlers async. `401` on bad signature; `200` even when handlers reject (their errors go through `onUnhandledHandlerError`). |
| Other  | `405 Method Not Allowed` with `Allow: GET, POST`.                                                                                                                                 |

## Why mount this BEFORE `express.json()`

The middleware uses `express.raw({ type: "application/json" })`
internally to capture the request body as **raw bytes** for HMAC
verification. If a global `express.json()` is registered earlier, it
consumes the body stream first and the raw-body handler sees nothing — you
get 401s on every webhook delivery.

Easiest rule: mount the WhatsApp middleware first, body parsers second.

```ts
const app = express();
app.use("/webhooks/whatsapp", createWhatsAppMiddleware(receiver)); // ← first
app.use(express.json()); // ← later
app.use("/api", apiRouter); // ← uses JSON
```

## Why ack 200 before awaiting handlers

Meta retries a webhook delivery on backoff for up to **7 days** if it
doesn't receive a 200 within ~30 seconds. A handler that takes 35
seconds (LLM call, slow downstream API, …) would otherwise blow the
budget and Meta would re-deliver — possibly multiple times — until your
handler queue is full of duplicates.

The middleware sends `res.status(200).end()` _before_ awaiting the
dispatch promise:

```ts
res.status(200).end();
result.dispatchPromise.catch(onUnhandledHandlerError);
```

If a handler throws after the ack, the response has already been sent.
The error is swallowed by the dispatch loop and forwarded to:

1. The receiver's `onError` callback (if set in
   `WebhookReceiverOptions`).
2. Any handler registered via `receiver.on("error", h)`.
3. `onUnhandledHandlerError` from the middleware options (default:
   `console.error`).

## Customising error handling

```ts
app.use(
  "/webhooks/whatsapp",
  createWhatsAppMiddleware(receiver, {
    onUnhandledHandlerError: (err) => {
      logger.error({ err }, "[whatsapp] handler escaped dispatch");
    },
  })
);
```

`onUnhandledHandlerError` is called with the rejection reason from
`dispatchPromise.catch(...)`. Note this fires only if **no** error
handler on the receiver itself caught the throw — typically you'd put
recovery logic on the receiver (`receiver.on("error", ...)`) and use
`onUnhandledHandlerError` purely as a last-resort logger.

## Testing the middleware

Use `supertest` against an in-memory Express app:

```ts
import express from "express";
import request from "supertest";
import { computeSignature } from "@dojocoding/whatsapp-sdk";
import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppMiddleware } from "@dojocoding/whatsapp-sdk/express";

const receiver = new WebhookReceiver({ appSecret: "S", verifyToken: "T" });
const app = express();
app.use("/wh", createWhatsAppMiddleware(receiver));

// GET handshake
await request(app)
  .get("/wh?hub.mode=subscribe&hub.verify_token=T&hub.challenge=1234")
  .expect(200, "1234");

// POST with valid signature
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
await request(app)
  .post("/wh")
  .set("Content-Type", "application/json")
  .set("X-Hub-Signature-256", "sha256=" + computeSignature(body, "S"))
  .send(body)
  .expect(200);
```

The integration suite at
[`test/integration/express/`](../test/integration/express/) is a
copy-paste source for more elaborate cases.

## Behind the scenes

The router implementation is short — about 100 lines including
`Buffer.isBuffer` defensiveness. Read it directly if anything surprises
you: [`packages/whatsapp-sdk/src/adapters/express/index.ts`](../src/adapters/express/index.ts).

The order of operations on a `POST`:

1. `express.raw({ type: "application/json" })` parses the body into a
   `Buffer` on `req.body`.
2. `Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)` — defensive
   when a downstream layer has already tampered.
3. Read `x-hub-signature-256` from headers (case-insensitive).
4. JSON-parse the raw body locally; on parse failure, pass `undefined`
   to the receiver (which tolerates non-objects and yields `[]` events).
5. `receiver.handlePayload(rawBody, sigHeader, parsed)` returns
   `{ status: 200, dispatchPromise }` or `{ status: 401 }`.
6. Send the response status. Attach `.catch(onUnhandledHandlerError)` to
   `dispatchPromise` if 200.

## Gotchas

- **`@dojocoding/whatsapp-sdk/express` is a sub-module.** Importing
  `createWhatsAppMiddleware` from `@dojocoding/whatsapp-sdk` directly will
  fail. Tooling that doesn't honour `package.json` `exports` may need a
  bundler config update.
- **Express ≥ 4.18 is the floor.** The middleware uses
  `express.raw({ type })`, available since 4.18. The dev dependency is
  pinned to `^4.22.1` for tests; runtime peer support starts at 4.18.
- **Mount path matters.** Use a unique path (`/webhooks/whatsapp` is
  conventional). Sharing a path with anything else introduces ordering
  issues that are hard to debug.
- **No response body on 401.** That's intentional — don't leak whether
  the signature was missing vs malformed vs mismatched. The status code
  alone is enough for Meta.

## Spec scenarios worth knowing

From `openspec/specs/framework-adapters/spec.md`:

- `GET` with valid handshake → `200` with the echoed challenge as
  `text/plain`.
- `GET` with wrong verify token → `403`.
- `POST` with valid signature dispatches the handler and acks within
  ~50 ms even if the handler resolves after 100 ms.
- `POST` with tampered body → `401`, no handler invoked.
- `PUT` / `DELETE` → `405` with `Allow: GET, POST`.
- A handler that throws still leaves the ack at `200`;
  `onUnhandledHandlerError` fires with the thrown error.
