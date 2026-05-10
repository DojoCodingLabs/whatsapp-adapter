# Webhooks (`webhook-receiver`)

The inbound side. Verify-token handshake, raw-body HMAC verification,
polymorphic event parsing, dedupe, and framework-agnostic dispatch.

If you're using Express, prefer the higher-level
[`createWhatsAppMiddleware`](./express.md) and skip this page on the first
read. The pieces here are what the middleware composes.

Spec: [`openspec/specs/webhook-receiver/spec.md`](../openspec/specs/webhook-receiver/spec.md).
Source: [`src/webhooks/`](../src/webhooks/).

## Public exports

```ts
import {
  WebhookReceiver,
  type WebhookReceiverOptions,
  type Handler,
  type ErrorHandler,
  type EventKindMap,
  // Lower-level pieces (rarely needed directly):
  verifyHandshake,
  type VerifyHandshakeInput,
  verifySignature,
  computeSignature,
  type VerifySignatureInput,
  parseWebhookPayload,
  WebhookDeduper,
  // Storage (re-exported for tracker / dedupe consumers)
  InMemoryStorage,
  type Storage,
  // Event types
  type WhatsAppEvent,
  type MessageEvent,
  type StatusEvent,
  type DeliveryStatus,
  type IncomingMessageKind,
  type TemplateStatusEvent,
  type TemplateQualityUpdateEvent,
  type TemplateCategoryUpdateEvent,
  type PhoneNumberQualityUpdateEvent,
  type AccountAlertEvent,
  type AccountReviewEvent,
  type UnknownEvent,
  type BaseEvent,
} from "@dojocoding/whatsapp";
```

## Construction

```ts
const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  storage: new InMemoryStorage(), // optional; default is a fresh InMemoryStorage
  dedupeTtlMs: 24 * 60 * 60 * 1000, // optional; default 24h
  onError: (err, event) => log.error("handler failed", { err, event }),
});
```

`appSecret` and `verifyToken` are the only required fields. See
[`compliance.md` § 3.2](./compliance.md#32-webhook-dedupe-ttl-is-1-hour)
for the rationale on the 1h default dedupe TTL.

## Registering handlers

```ts
receiver
  .on("message", async (e) => {
    /* incoming message */
  })
  .on("status", async (e) => {
    /* sent / delivered / read / failed */
  })
  .on("template_status", async (e) => {
    /* APPROVED / REJECTED / PAUSED / DISABLED */
  })
  .on("error", (err, event) => {
    /* handler exceptions surface here */
  });
```

Multiple handlers per kind are allowed (each is a `Set`). They run via
`Promise.allSettled`, so one slow or throwing handler does not block the
others. Unhandled exceptions land on the `error` channel **and** are
passed to the constructor `onError` if provided.

### Event kinds

| Kind                   | Event type                      | Triggered by Meta `field` value               |
| ---------------------- | ------------------------------- | --------------------------------------------- |
| `message`              | `MessageEvent`                  | `messages` (one event per `value.messages[]`) |
| `status`               | `StatusEvent`                   | `messages` (one event per `value.statuses[]`) |
| `template_status`      | `TemplateStatusEvent`           | `message_template_status_update`              |
| `template_quality`     | `TemplateQualityUpdateEvent`    | `message_template_quality_update`             |
| `template_category`    | `TemplateCategoryUpdateEvent`   | `template_category_update`                    |
| `phone_number_quality` | `PhoneNumberQualityUpdateEvent` | `phone_number_quality_update`                 |
| `account_alert`        | `AccountAlertEvent`             | `account_alerts`                              |
| `account_review`       | `AccountReviewEvent`            | `account_review_update`                       |
| `unknown`              | `UnknownEvent`                  | anything else (forward-compatible)            |
| `error`                | (special)                       | a handler threw                               |

Inbound message types narrow further via `event.type`:

```ts
type IncomingMessageKind =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | "interactive_button_reply"
  | "interactive_list_reply"
  | "button"
  | "order"
  | "reaction"
  | "system"
  | "unsupported";
```

`event.body` is the raw Meta-shaped object for that message, kept as
`Record<string, unknown>` so consumers can progressively narrow without
locking the SDK to every possible inbound shape.

## Without a framework adapter

```ts
import { WebhookReceiver } from "@dojocoding/whatsapp";
import { createServer } from "node:http";

const receiver = new WebhookReceiver({ appSecret, verifyToken });
receiver.on("message", async (e) => {
  console.log("msg from", e.from, "wamid", e.id);
});

const server = createServer(async (req, res) => {
  if (req.method === "GET") {
    const url = new URL(req.url ?? "", "http://localhost");
    const result = receiver.handleVerifyRequest({
      mode: url.searchParams.get("hub.mode"),
      verifyToken: url.searchParams.get("hub.verify_token"),
      challenge: url.searchParams.get("hub.challenge"),
    });
    if (result.status === 200) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(result.body);
    } else {
      res.writeHead(403);
      res.end();
    }
    return;
  }

  if (req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const rawBody = Buffer.concat(chunks);
    const sig = req.headers["x-hub-signature-256"] as string | undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      parsed = undefined;
    }

    const result = receiver.handlePayload(rawBody, sig ?? null, parsed);
    res.writeHead(result.status);
    res.end();
    if (result.status === 200) {
      // Run handlers in the background — do NOT await before res.end()
      result.dispatchPromise.catch((err) => console.error("handler failed", err));
    }
    return;
  }

  res.writeHead(405, { Allow: "GET, POST" });
  res.end();
});
```

The contract:

- `handleVerifyRequest` returns `{ status: 200, body }` (echo the
  challenge) or `{ status: 403 }`.
- `handlePayload` returns `{ status: 401 }` if the signature fails, or
  `{ status: 200, dispatchPromise }` on success. Dispatch the promise
  _after_ `res.end()` so a slow handler doesn't blow Meta's 30s ack
  budget. Meta retries failed deliveries with backoff for up to 7 days.

For Express, use `createWhatsAppMiddleware(receiver)` instead — it does
all of the above. See [`express.md`](./express.md).

## Sample inbound payload

A canonical Meta `messages` envelope (from
`test/__fixtures__/webhooks/text-inbound.json`):

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WABA_ID",
      "changes": [
        {
          "field": "messages",
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "+15551234567",
              "phone_number_id": "PHONE_ID"
            },
            "contacts": [{ "profile": { "name": "Daniel" }, "wa_id": "521234567890" }],
            "messages": [
              {
                "from": "521234567890",
                "id": "wamid.text-1",
                "timestamp": "1735689600",
                "text": { "body": "hello adapter" },
                "type": "text"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

After `parseWebhookPayload(body)` you get:

```ts
[
  {
    kind: "message",
    wabaId: "WABA_ID",
    phoneNumberId: "PHONE_ID",
    displayPhoneNumber: "+15551234567",
    timestamp: 1735689600000, // normalised to ms epoch
    id: "wamid.text-1",
    from: "521234567890",
    type: "text",
    body: {
      /* the raw Meta message object */
    },
    // contextId: undefined          // present if it's a reply
  },
];
```

More fixtures live in [`test/__fixtures__/webhooks/`](../test/__fixtures__/webhooks/):
`button-reply.json`, `list-reply.json`, `phone-quality-update.json`,
`status-failed.json`, `status-sent.json`, `template-status-approved.json`,
`text-inbound.json`, `two-messages.json`, `unknown-field.json`. They're
real Meta-shaped envelopes with PII redacted.

## Dedupe

Meta retries delivery on backoff for up to 7 days, so the same wamid can
arrive multiple times. The receiver dedupes via `WebhookDeduper` keyed by:

- `msg:<wamid>` for `message` events
- `status:<wamid>:<status>` for `status` events (so transitions
  `sent → delivered → read → failed` are not collapsed)

Other event kinds are not deduped (template-status updates etc. are
already idempotent on the consumer side).

For multi-instance deployments, plug a Redis-backed `Storage` into the
constructor so all instances share the dedupe set. See
[`compliance.md` § 3.2](./compliance.md#32-webhook-dedupe-ttl-is-1-hour)
for TTL guidance.

## Signature verification — by hand

If you need to verify outside `WebhookReceiver` (e.g. in a custom
framework adapter):

```ts
import { verifySignature } from "@dojocoding/whatsapp";

const ok = verifySignature({
  rawBody: req.body, // Buffer | Uint8Array | string
  signatureHeader: req.headers["x-hub-signature-256"],
  appSecret: process.env.WHATSAPP_APP_SECRET!,
});
if (!ok) return res.status(401).end();
```

`verifySignature` returns `false` (never throws) on every failure
mode — missing header, malformed hex, wrong byte length, mismatch. The
comparison is timing-safe.

`computeSignature(rawBody, appSecret)` is the inverse — useful in tests
that need to produce a valid header.

## Gotchas

- **Raw body must be raw bytes, not a re-serialised JSON string.** Even
  byte-for-byte-equivalent JSON can fail if whitespace or key order
  changed. Capture before any parser.
- **Don't `await dispatchPromise` inside the HTTP handler.** That defeats
  the 30s ack guarantee.
- **Handler errors don't fail the ack.** The 200 has already been sent.
  Use `onError` (constructor) or `.on("error", …)` for visibility.
- **`unknown` events are first-class.** Meta has shipped new `field`
  values without notice. Don't crash on them — register a handler for
  `unknown` if you want visibility.
- **`event.body` is `Record<string, unknown>`.** Narrow it yourself based
  on `event.type`; the SDK doesn't enumerate every Meta inbound shape.
- **`displayPhoneNumber` includes the `+` prefix.** `phoneNumberId` does
  not — it's an opaque id, not a phone number.

## Spec scenarios worth knowing

From `openspec/specs/webhook-receiver/spec.md`:

- Tampered body → `verifySignature` returns `false` (no throw).
- Wrong / missing / malformed signature → 401, no handler invocation.
- Same wamid received twice → handler invoked exactly once.
- Status updates with the same wamid but different `status` values →
  both dispatched (transition tracking).
- Handler throws → `error` event fires; other handlers still run.
- Unknown `field` value → emitted as `{ kind: "unknown", field, value }`.
