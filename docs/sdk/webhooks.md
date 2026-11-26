# Webhooks (`webhook-receiver`)

The inbound side. Verify-token handshake, raw-body HMAC verification,
polymorphic event parsing, dedupe, and framework-agnostic dispatch.

If you're using Express, prefer the higher-level
[`createWhatsAppMiddleware`](./express.md) and skip this page on the first
read. The pieces here are what the middleware composes.

Spec: [`openspec/specs/webhook-receiver/spec.md`](../openspec/specs/webhook-receiver/spec.md).
Source: [`packages/whatsapp-sdk/src/webhooks/`](../src/webhooks/).

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
  // Typed accessors over MessageEvent.body (pure, never throw)
  messageSenderKey,
  messageText,
  messageReplyId,
  messageMedia,
  messageReferral,
  messageIdentityChange,
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
  type WebhookErrorEvent,
  type WebhookErrorDetail,
  type WebhookContact,
  type BaseEvent,
} from "@dojocoding/whatsapp-sdk";
```

## Construction

```ts
const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  storage: new InMemoryStorage(), // optional; default is a fresh InMemoryStorage
  dedupeTtlMs: 7 * 24 * 60 * 60 * 1000, // optional; default 7 days (Meta's redelivery window)
  onError: (err, event) => log.error("handler failed", { err, event }),
});
```

`appSecret` and `verifyToken` are the only required fields. See
[`compliance.md` § 3.2](../compliance.md#32-webhook-dedupe-ttl--widened-to-7-days-)
for the rationale on the 7-day default dedupe TTL.

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

#### `StatusEvent` pricing fields

Meta attaches a `pricing` envelope to the `sent` status **and** to one
of `delivered` / `read` (never both) of every outbound message. The
parser lifts it into flat optional fields:

| Field             | Source                  | Values                                                                                                                                                                                     |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pricingCategory` | `pricing.category`      | `utility` · `marketing` · `marketing_lite` · `authentication` · `authentication-international` · `service` · `referral_conversion` · `group_marketing` · `group_service` · `group_utility` |
| `pricingType`     | `pricing.type`          | `regular` · `free_customer_service` · `free_group_customer_service` · `free_entry_point`                                                                                                   |
| `pricingSubtype`  | `pricing.subtype`       | `free_tier` · `paid_exempt` (free service messages only)                                                                                                                                   |
| `pricingModel`    | `pricing.pricing_model` | `PMP` (per-message, current) · `CBP` (legacy conversation-based)                                                                                                                           |
| `billable`        | `pricing.billable`      | `boolean` — Meta will deprecate it; prefer `pricingType` + `pricingCategory`                                                                                                               |
| `conversationId`  | `conversation.id`       | Usually **absent** since Graph API v24.0; present only inside a free entry-point window                                                                                                    |

`pricingType` (+ `pricingSubtype`) is what to reconcile invoices
against. Since **Oct 1, 2026** `free_customer_service` means a free 1:1
service delivery (e.g. inside the phone number's free tier), not
"every in-window reply"; `pricingSubtype` tells `free_tier` from
`paid_exempt`. All values are open strings. See
[`compliance.md` § 2](../compliance.md#2-what-the-consumer-must-enforce).
| `user_preferences` | `UserPreferencesEvent` | `user_preferences` (one event per entry) |
| `webhook_error` | `WebhookErrorEvent` | `messages` change carrying `value.errors` (system / app / account errors) |
| `unknown` | `UnknownEvent` | anything else (forward-compatible) |
| `error` | (special) | a handler threw |

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
  | "interactive_nfm_reply" // WhatsApp Flows completion
  | "interactive_product" // single product sent from your catalog
  | "button" // template quick-reply tap
  | "order"
  | "reaction"
  | "system"
  | "edit" // Coexistence only
  | "revoke" // Coexistence only
  | "request_welcome" // deprecated: Meta removed it 2026-03-27
  | "unsupported";
```

### Sender identity (BSUID / usernames)

Users who adopt a WhatsApp username and don't share their phone number
arrive **without** `messages[].from`. Meta identifies them by a
business-scoped user id (BSUID, `from_user_id`, e.g.
`"US.13491208655302741918"`). The SDK keeps `MessageEvent.from` a
`string` for backward compatibility, so it is `""` for those users —
**never key state on `from` alone**:

| Field              | Source                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `from`             | `messages[].from` — phone WA id, `""` when omitted                                                                                                                                               |
| `fromUserId`       | `messages[].from_user_id`, else the joined contact's `user_id`                                                                                                                                   |
| `fromParentUserId` | `messages[].from_parent_user_id` (parent BSUIDs enabled)                                                                                                                                         |
| `contact`          | `value.contacts[]` entry (`waId`, `userId`, `parentUserId`, `username`, `profileName`, `identityKeyHash`), matched by `wa_id`, then `user_id`, then the single contact of a single-message batch |
| `groupId`          | `messages[].group_id` (group messages)                                                                                                                                                           |
| `errors`           | `messages[].errors` (on `unsupported`)                                                                                                                                                           |

`messageSenderKey(e)` returns the phone WA id when present, otherwise
the BSUID — use it for conversation ids, window tracking and CTWA
caches. Phone-first means existing phone-keyed data keeps its keys.
Dedupe stays on the wamid.

BSUIDs rotate. Meta announces it as a `system` message
(`user_changed_user_id`, no `from`, no contacts):

```ts
receiver.on("message", async (e) => {
  const change = messageIdentityChange(e);
  if (change?.type === "user_changed_user_id") {
    await crm.relinkUser(change.previousUserId, change.userId);
  }
});
```

`StatusEvent` mirrors this: `recipientId` is omitted for BSUID sends
without a phone number, `recipientUserId` / `recipientParentUserId`
carry the BSUID, `contact` holds the status-side contact (none on
`failed`), and `bizOpaqueCallbackData` echoes what you attached on send.

### Typed accessors

`event.body` stays the raw Meta object. Pure helpers narrow the common
shapes so you don't hand-roll the casts:

| Helper                     | Returns                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `messageText(e)`           | `text.body`, template `button.text`, interactive `button_reply` / `list_reply` title              |
| `messageReplyId(e)`        | `button_reply.id`, `list_reply.id`, template `button.payload`                                     |
| `messageMedia(e)`          | `{ kind, id, mimeType?, sha256?, url?, voice?, animated?, caption?, filename? }` for media types  |
| `messageReferral(e)`       | camelCase CTWA referral (`ctwaClid`, `sourceId`, `imageUrl`, `videoUrl`, `welcomeMessageText`, …) |
| `messageIdentityChange(e)` | `user_changed_user_id` (new / previous BSUIDs) or `user_changed_number` details                   |
| `messageSenderKey(e)`      | phone WA id, else BSUID, else `""`                                                                |

### Value-level errors (`webhook_error`)

System-, app- and account-level errors arrive as
`entry[].changes[].value.errors`, often with no messages or statuses.
The SDK emits one `WebhookErrorEvent` (`field`, `errors[]` with
`code`, `title`, `message`, `error_data.details`, `href`) per change;
earlier releases dropped them silently. It is not deduped.

`event.body` is the raw Meta-shaped object for that message, kept as
`Record<string, unknown>` so consumers can progressively narrow without
locking the SDK to every possible inbound shape.

Two kinds deserve a note:

- **`interactive_nfm_reply`** — the customer completed a WhatsApp Flow.
  The submitted fields are in
  `body.interactive.nfm_reply.response_json`, a JSON **string**:

  ```ts
  receiver.on("message", (e) => {
    if (e.type !== "interactive_nfm_reply") return;
    const nfm = (e.body.interactive as { nfm_reply: { response_json: string } }).nfm_reply;
    const answers = JSON.parse(nfm.response_json) as Record<string, unknown>;
    // answers.flow_token identifies the Flow session you started.
  });
  ```

- **`request_welcome`** (deprecated) — Meta removed the
  `request_welcome` webhook and welcome-message feature on 2026-03-27.
  The SDK still classifies it so replayed payloads don't collapse to
  `"unsupported"`; don't build new flows on it.

### Marketing opt-out signal (`user_preferences`)

When a customer taps "Stop" (or "Resume") on your marketing messages,
Meta sends the `user_preferences` field. The SDK emits one
`UserPreferencesEvent` per entry:

```ts
interface UserPreferencesEvent {
  kind: "user_preferences";
  waId: string; // phone WA id; "" when Meta omits it (username users)
  userId?: string; // BSUID
  parentUserId?: string;
  category: "marketing_messages" | string;
  value: "stop" | "resume" | string;
  detail?: string; // Meta's description
  timestamp: number; // epoch ms
  raw: Record<string, unknown>;
}
```

This is Meta's authoritative opt-out. Wire it to your `OptInRegistry`
so MARKETING template sends fail pre-flight with `OptOutError` instead
of at Meta with `131050` (and so you never accumulate the `131049`
retries that Meta now penalises at WABA level):

```ts
receiver.on("user_preferences", async (e) => {
  if (e.category !== "marketing_messages") return;
  if (e.value === "stop") {
    await registry.optOut(e.waId, {
      category: "MARKETING",
      reason: e.detail ?? "user_preferences",
    });
  } else if (e.value === "resume") {
    await registry.optIn(e.waId, { category: "MARKETING", source: "user_preferences" });
  }
});
```

Username users without a shareable phone arrive with `waId: ""`; key
the opt-out on `e.userId` then (`e.waId || e.userId`).

Replays of the same preference change are deduped by the receiver
(identity + `category + value + timestamp`, where identity is `waId`,
or `bsuid:<userId>` when `waId` is empty — so two username users
opting out in the same second don't collide).

### Click-to-WhatsApp (CTWA) referral

When a user clicks a Click-to-WhatsApp ad and then sends their **first**
message, Meta attaches a `referral` object to that one message. The SDK
exposes it as `MessageEvent.referral`:

```ts
import type { MessageEvent, WhatsAppReferral } from "@dojocoding/whatsapp-sdk";

receiver.on("message", async (e: MessageEvent) => {
  if (e.referral?.ctwa_clid) {
    await metaCapi.recordConversation({
      action_source: "business_messaging",
      event_name: "ContactBusiness",
      ctwa_clid: e.referral.ctwa_clid,
      ad_id: e.referral.source_id,
      // ...
    });
  }
  // ...continue with your inbound handling
});
```

Documented fields on `WhatsAppReferral`: `ctwa_clid`, `source_url`,
`source_type` (`"ad" | "post"`), `source_id`, `headline`, `body`,
`media_type`, `image_url`, `video_url`, `thumbnail_url`,
`welcome_message.text` (`media_url` and `welcome_message.message_id`
remain as deprecated legacy keys). `messageReferral(e)` returns a
camelCase view. `ctwa_clid` is omitted for ads shown in WhatsApp
Status. The
field type is a permissive intersection with `Record<string, unknown>`,
so unknown future fields Meta adds are preserved at runtime without
an SDK release.

Attribution semantics to know:

- **Only the first message** after the click carries `referral`.
  Subsequent messages in the same conversation do not. Cache
  `ctwa_clid` keyed on `messageSenderKey(e)` if you need it across a
  multi-turn flow.
- **Empty `referral: {}`** is preserved (not dropped) so you can
  distinguish "no referral" (`undefined`) from "referral present but
  Meta omitted details" (`{}`).
- **`ctwa_clid` has a Meta-side TTL** (currently a few days for
  conversion attribution); persist it with an expiry alongside your
  conversation record, not forever.

## Without a framework adapter

```ts
import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { createServer } from "node:http";

const receiver = new WebhookReceiver({ appSecret, verifyToken });
receiver.on("message", async (e) => {
  console.log("msg type", e.type); // never log from / BSUID / text
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
    body: {/* the raw Meta message object */},
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
- `pref:<waId | bsuid:userId>:<category>:<value>:<timestamp>` for
  `user_preferences` events

Other event kinds are not deduped (template-status updates etc. are
already idempotent on the consumer side).

For multi-instance deployments, plug a Redis-backed `Storage` into the
constructor so all instances share the dedupe set. See
[`compliance.md` § 3.2](../compliance.md#32-webhook-dedupe-ttl--widened-to-7-days-)
for TTL guidance. With the 7-day default each message and status
transition holds one small key for a week; size Redis / Postgres for
your weekly volume, or pass a shorter `dedupeTtlMs` if your handlers
are idempotent.

### Dedupe happens _before_ dispatch — a throwing handler is not retried

The receiver marks a wamid as seen **before** it runs your handlers.
If a handler throws, the error goes to the `error` channel /
`onError`, Meta still gets its 200 (the adapters ack before
dispatch), and when Meta retries the same delivery the receiver drops
it as a duplicate. Net effect: **at-most-once** delivery to your
handlers per wamid, not at-least-once.

This is deliberate. Meta's redelivery is a transport-level retry for
_failed HTTP acks_, not a work queue — leaning on it for handler
retries would replay every _successful_ side effect a partially-failed
handler already performed (a reply already sent, a row already
inserted), and it stops after 7 days regardless. If your handler needs
retry semantics, own them explicitly:

```ts
receiver.on("message", async (e) => {
  // Hand off to your own durable queue; the handler itself does the
  // minimum and cannot meaningfully fail.
  await queue.enqueue({ kind: "inbound", event: e });
});
```

Every failure inside the receiver still surfaces — through `onError`
and the `error` channel, and as an `ERROR` status on the handler's
OTel span — so nothing is swallowed silently.

## Signature verification — by hand

If you need to verify outside `WebhookReceiver` (e.g. in a custom
framework adapter):

```ts
import { verifySignature } from "@dojocoding/whatsapp-sdk";

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
