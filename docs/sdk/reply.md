# Agent replies (`agent-reply`)

Helpers for LLM agents that answer people on WhatsApp. An agent
produces a reply — text of any length, or buttons / a list / a link
button with whatever titles it came up with — and these helpers get
it through Meta's limits and back out the other side as one or more
Cloud API messages. They sit on top of the strict builders
([`messages.md`](./messages.md)): limits come from
`MESSAGE_LENGTH_LIMITS`, and every interactive payload is still
validated by `buildInteractiveButton` / `List` / `CtaUrl`.

Ported from the production Doji / Setter agents (eve on Vercel), with
consumer copy removed: the SDK ships no acknowledgement text, no
emoji and no "what next?" prompts. You supply your own wording in
your own tone.

Spec: `openspec/changes/add-agent-reply-layer/specs/agent-reply/spec.md`
(stable spec `openspec/specs/agent-reply/spec.md` once archived).
Source: [`packages/whatsapp-sdk/src/reply/`](../../packages/whatsapp-sdk/src/reply/).

## Public exports

```ts
import {
  // text
  splitText,
  clipText,
  toWhatsAppText,
  // interactive
  type Reply,
  type ReplyOption,
  type InteractiveReply,
  toInteractiveReply,
  replyAsText,
  interactiveBodyLimit,
  MAX_REPLY_BUTTONS,
  MAX_LIST_ROWS,
  // sending
  deliverReply,
  type DeliverReplyOptions,
  type DeliveredReply,
  type ReplyClient,
  isInteractiveFallbackError,
  DEFAULT_CONTINUATION_BODY,
  // window + opt-out
  outboundMode,
  type OutboundMode,
  WINDOW_MARGIN_MS,
  detectOptOut,
  OPT_OUT_MAX_LENGTH,
} from "@dojocoding/whatsapp-sdk";
```

## Text

- `splitText(text, max = 4096)` splits into messages of at most `max`
  Unicode code points and never drops a character. In each window it
  prefers a paragraph break, then a line break, then a sentence end
  (`". "`), then a space — only in the last half of the window. Only
  an unbroken run longer than `max` is cut mid-word. Emoji are never
  split in half.
- `clipText(text, max)` trims and clips to `max` code points, ending
  in `…`. Use it for titles and labels, never for message bodies.
- `toWhatsAppText(markdown)` converts what models usually write:
  `# Heading` → `*Heading*`, `**b**` → `*b*`, `__i__` → `_i_`,
  `~~s~~` → `~s~`, `[text](https://url)` → `text: https://url`.

## Interactive replies

```ts
type Reply =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: ReplyOption[]; header?; footer? }
  | {
      kind: "list";
      body: string;
      button: string;
      rows: ReplyOption[];
      sectionTitle?;
      header?;
      footer?;
    }
  | { kind: "cta_url"; body: string; cta: { label: string; url: string }; header?; footer? };

interface ReplyOption {
  id?: string; // defaults to title
  title: string;
  description?: string; // list rows only
}
```

`toInteractiveReply(to, reply, { body?, replyTo? })` returns a
`BuildInteractiveInput` for `client.sendInteractive(...)`. It is
tolerant where the strict builders are not:

- titles, labels, header, footer and body are clipped to
  `MESSAGE_LENGTH_LIMITS` with `…`;
- options with a duplicate id or title are dropped (Meta rejects
  duplicates), as are empty ones;
- at most 3 buttons and 10 rows are kept;
- a list gets one section, titled `sectionTitle` or the button label.

The strict builder still has the last word: if nothing usable is
left (empty body, no options, invalid URL) it throws a
`WhatsAppError`, which `deliverReply` treats like a Meta rejection.

The list body limit is read from `MESSAGE_LENGTH_LIMITS.listBody`
when present (Meta allows 4096 for list bodies), otherwise
`interactiveBody` (1024).

`replyAsText(reply)` is the plain-text form: `body`, then numbered
options (`1. Title`, rows as `1. Title (description)`), or the URL
for a cta_url.

## `deliverReply(client, to, reply, options?)`

The one outbound path for an agent reply:

| Reply                        | What is sent                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `text`                       | `splitText(body)` → one text message per part                                |
| interactive, short body      | the interactive message                                                      |
| interactive, body over limit | the body as text parts, then the interactive with `options.continuationBody` |
| interactive refused by Meta  | `replyAsText(...)` as text parts; result has `fallback: true`                |

Returns `{ kind, messages, fallback?, messageIds }` — `kind` is what
actually went out (`"text"` after a fallback).

Options:

- `continuationBody` — short body for the interactive that follows a
  long prompt. Default `"…"` (neutral on purpose). Set it in your
  language and tone, e.g. `"¿Qué hacemos?"` or `"Choose one:"`.
- `previewUrl` — `"auto"` (default: on when a part contains a URL),
  `true` or `false`.
- `replyTo` — quote an inbound wamid on the first message.
- `requestOptions` — forwarded to every send (`signal`,
  `retryPolicy`, …).

**Fallback vs propagate.** The plain-text fallback runs for any
`WhatsAppError` that means "Meta did not like this payload"
(`CapabilityError` for codes 100 / 131009, `UNKNOWN`, the strict
builder's own rejection). These propagate unchanged, because text
would fail the same way or the interactive may already have been
delivered:

`WindowClosedError`, `OptOutError`, `AuthenticationError`,
`RateLimitError`, `MissingCredentialsError`, `PermissionError`,
`AccountRestrictedError`, `UndeliverableError`, `TransientError`,
`NetworkError`, `RequestAbortedError`, `MockModeError` — and any
error that is not a `WhatsAppError`.

`isInteractiveFallbackError(err)` exposes the same decision.

`deliverReply` accepts any `ReplyClient` (`sendText` +
`sendInteractive`): `WhatsAppClient` and `MockWhatsAppClient` both
fit. If the client has a `windowTracker`, a closed window throws
`WindowClosedError` before any HTTP.

## `outboundMode({ now, lastInboundAt, optedOut, hasTemplate, marginMs? })`

A pure decision for messages the agent wants to send:

- `"session"` — the last inbound message is less than
  24 h − `marginMs` ago (default `WINDOW_MARGIN_MS`, 5 minutes): any
  message. An opted-out person who just wrote still gets the answer.
- `"template"` — outside the window, not opted out, and an approved
  template is available.
- `"drop"` — outside the window and no template may be sent.

The margin covers sends that start at 23:59 and land after the
window closes. Pass timestamps your `WindowTracker` or database
already holds (epoch ms or `Date`).

## `detectOptOut(text)`

Detects a typed opt-out — "STOP", "baja", "no me escriban", "stop
messaging me", "unsubscribe" — and returns the language of the
matched pattern (`"es"` | `"en"`) or `null`. Only short messages
count (≤ 80 characters after normalizing accents, case and
punctuation), so a person quoting "no me escriban" inside a longer
story is not opted out. A bare `STOP` is classified `"es"`.

The SDK sends no acknowledgement: pick your own copy (usted vs tú,
brand voice) from the returned language.

**Meta stays authoritative.** For marketing messages, Meta's
`user_preferences` webhook (see [`webhooks.md`](./webhooks.md)) and
error `131050` (`OptOutError`) are the source of truth. `detectOptOut`
is the free-text keyword fallback for people who simply type it;
record the result in your `OptInRegistry` or database.

## Example: an eve channel

A sketch of an eve (`eve/channels`) channel that owns its own POST
route. The SDK has no eve dependency; this only shows the wiring.

```ts
import { defineChannel, GET, POST } from "eve/channels";
import {
  deliverReply,
  detectOptOut,
  toWhatsAppText,
  WebhookDeduper,
  InMemoryStorage,
  WhatsAppClient,
  verifyHandshake,
} from "@dojocoding/whatsapp-sdk";
import { verifyAndParseWebhook } from "@dojocoding/whatsapp-sdk/web";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
});
const deduper = new WebhookDeduper(new InMemoryStorage()); // Redis in production

export default defineChannel({
  routes: [
    GET("/whatsapp/webhook", async (request) => {
      const q = new URL(request.url).searchParams;
      const challenge = verifyHandshake({
        mode: q.get("hub.mode"),
        verifyToken: q.get("hub.verify_token"),
        challenge: q.get("hub.challenge"),
        expectedToken: process.env.WHATSAPP_VERIFY_TOKEN!,
      });
      return challenge === null ? new Response(null, { status: 403 }) : new Response(challenge);
    }),
    POST("/whatsapp/webhook", async (request, { waitUntil }) => {
      const result = await verifyAndParseWebhook(request, {
        appSecret: process.env.WHATSAPP_APP_SECRET!,
      });
      if (result.status !== 200) return new Response(null, { status: result.status });

      // Ack now; work after the response (Meta's 30 s rule).
      waitUntil(
        (async () => {
          for (const event of result.events) {
            if (event.kind !== "message" || !(await deduper.markIfNew(event.id))) continue;
            const text =
              event.type === "text" ? ((event.body.text as { body?: string }).body ?? "") : "";
            const optOut = detectOptOut(text);
            if (optOut) {
              // store the opt-out, then acknowledge in YOUR tone
              await deliverReply(client, event.from, {
                kind: "text",
                body: optOut === "es" ? "Entendido, no le volveremos a escribir." : "Understood.",
              });
              continue;
            }
            const answer = await runAgentTurn(text); // your model call → Reply
            await deliverReply(
              client,
              event.from,
              answer.kind === "text" ? { ...answer, body: toWhatsAppText(answer.body) } : answer,
              { continuationBody: "¿Qué hacemos?", replyTo: event.id }
            );
          }
        })()
      );
      return new Response(null, { status: 200 });
    }),
  ],
});
```

Event field names follow [`webhooks.md`](./webhooks.md); check them
against the version you install.
