# Inbound auto-responder

The smallest meaningful integration: receive customer messages and reply
with canned answers based on simple intent matching. A good "hello
world" beyond the README quickstart, and the floor for everything else.

## Why this shape

- All replies are **inside the 24-hour window** (the customer just
  messaged you), so free-form `sendText` works without templates.
- Wire `tracker.notifyInbound(e.from)` from the message handler so any
  later outbound send is window-gated correctly.
- Idempotent by `wamid` — Meta's webhook redeliveries don't double-fire
  the handler.
- One file, ~40 lines of logic. The shape generalises to anything more
  ambitious by replacing `classify(text)` with a real classifier.

## Code

```ts
import "dotenv/config";
import express from "express";
import {
  WebhookReceiver,
  WhatsAppClient,
  WindowTracker,
  InMemoryStorage,
} from "@dojocoding/whatsapp";
import { createWhatsAppMiddleware } from "@dojocoding/whatsapp/express";

const tracker = new WindowTracker({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  storage: new InMemoryStorage(),
});

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  token: process.env.WHATSAPP_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  windowTracker: tracker,
});

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});

receiver.on("message", async (e) => {
  await tracker.notifyInbound(e.from);
  if (e.type !== "text") return; // only handle text in v1

  const text = (e.body.text as { body?: string } | undefined)?.body ?? "";
  const reply = classify(text);
  await client.sendText({ to: e.from, body: reply, replyTo: e.id });
});

receiver.on("error", (err, event) => {
  console.error("[whatsapp] handler failed", { err, eventId: (event as { id?: string }).id });
});

function classify(text: string): string {
  const lower = text.toLowerCase();
  if (/horario|hours?|open/.test(lower)) return "We're open Mon–Fri, 9am–6pm CST.";
  if (/precio|price|cost/.test(lower)) return "Pricing details: https://example.com/pricing";
  if (/^(hi|hola|hello)\b/.test(lower)) return "Hello! How can I help today?";
  return "I'm not sure I understand — try asking about hours, pricing, or location.";
}

const app = express();
app.use("/webhooks/whatsapp", createWhatsAppMiddleware(receiver));
app.listen(3000, () => console.log("listening on :3000"));
```

## Things that bite

- **Don't await any send before `tracker.notifyInbound(...)`.** If the
  send fails, the window never opens and your next reply throws
  `WindowClosedError`.
- **`event.body` is `Record<string, unknown>`.** Narrow per `event.type`
  (here we cast `body.text` after checking `type === "text"`). Don't
  trust the shape unconditionally.
- **`replyTo: e.id` is optional but recommended.** It threads the reply
  in the customer's WhatsApp UI and helps you correlate logs.
- **The handler runs async on `dispatchPromise`.** A slow `classify`
  doesn't delay Meta's 200 ack; thrown errors land on
  `receiver.on("error", …)` and `options.onUnhandledHandlerError`
  on the Express middleware.
- **Don't log `e.body` unfiltered.** It contains user message text
  (PII). Narrow to the fields you actually need.

## Where to go from here

- Replace `classify()` with an LLM call (Haiku is plenty for intent;
  Sonnet for drafting). Wrap the LLM call in
  [`withSpan`](../observability.md#withspanname-fn-attributes) so it
  shows up in your traces alongside the SDK's spans.
- Promote to a multi-turn conversation: see
  [Two-way support with handoff](./two-way-support-with-handoff.md).
- Promote to structured collection: see
  [Appointment booking](./appointment-booking.md).
