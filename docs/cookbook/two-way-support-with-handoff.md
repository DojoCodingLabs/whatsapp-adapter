# Two-way support with handoff

A bot handles tier-1 inbound; an escalation detector decides when to
hand off to a human; the human picks up in the bot's voice via a
separate HITL inbox app. The customer never sees the boundary.

This is the canonical agentic two-way support shape — what most LATAM
WhatsApp bots fail at, and what makes a deployed agent qualitatively
better than the decision-tree bots it replaces. A documented
real-world failure-mode taxonomy ("Danissa antipattern") that motivates
this shape lives in
[`CLIENT_AGENTS_MASTER_PLAN.md`](../../../CLIENT_AGENTS_MASTER_PLAN.md)
if you have access — it's worth reading even if you're not on that
project.

## Why this shape

- **One WhatsApp number, two operators (bot + human).** Human handoff
  doesn't change the phone number the customer is messaging.
- **Escalation is a parallel signal**, not a tree branch. Run an
  escalation detector on every inbound; if it fires, queue a handoff
  packet for the HITL inbox and stop generating bot replies for that
  conversation.
- **Conversation state is per-`from`** and lives outside this SDK
  (this SDK doesn't store conversation history). Use Postgres / Redis
  / your storage of choice; key by `(phoneNumberId, customerWaId)`.
- **Bot replies are window-aware.** Inside the 24h window: free-form
  send. Outside: utility template for the explicit cases the bot is
  allowed to re-engage on (e.g., "your booking is confirmed").

## Code (minimal, agent-shaped)

```ts
import "dotenv/config";
import express from "express";
import {
  WebhookReceiver,
  WhatsAppClient,
  WindowTracker,
  WindowClosedError,
  RateLimitError,
  AuthenticationError,
  InMemoryStorage,
  type MessageEvent,
} from "@dojocoding/whatsapp";
import { createWhatsAppMiddleware } from "@dojocoding/whatsapp/express";

const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;

const tracker = new WindowTracker({ phoneNumberId, storage: new InMemoryStorage() });
const client = new WhatsAppClient({
  phoneNumberId,
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

  // 1. If this conversation is already escalated, do nothing — the
  //    human will pick up via the HITL inbox.
  if (await isEscalated(phoneNumberId, e.from)) return;

  // 2. Run intent + escalation detection in parallel.
  const text = textOf(e);
  const [intent, escalation] = await Promise.all([
    classifyIntent(text), // your LLM call (Haiku)
    detectEscalation(text, e), // your LLM call (Haiku)
  ]);

  if (escalation.shouldEscalate) {
    await escalate(phoneNumberId, e, escalation.reason);
    return;
  }

  // 3. Generate the reply. Wrap your LLM call in withSpan so it
  //    correlates with the SDK's whatsapp.* spans.
  const reply = await draftReply(intent, text, e);
  if (!reply) return;

  try {
    await client.sendText({ to: e.from, body: reply, replyTo: e.id });
  } catch (err) {
    if (err instanceof WindowClosedError) {
      // shouldn't happen — we just notified — but be defensive
      console.warn("[bot] window closed despite recent inbound", { from: e.from });
    } else if (err instanceof RateLimitError) {
      // already retried per policy; queue for the HITL queue with low priority
      await escalate(phoneNumberId, e, "rate-limited; needs human follow-up");
    } else if (err instanceof AuthenticationError) {
      // token rotation needed — alert ops; don't retry
      console.error("[bot] auth error — rotate token", err);
      throw err;
    } else {
      throw err;
    }
  }
});

receiver.on("status", (e) => {
  // Useful: when delivery fails (status === "failed"), queue a retry
  // or surface to ops. errors[] carries the Meta failure reason.
});

receiver.on("template_status", (e) => {
  // Re-validate any cached TemplateDefinition when Meta transitions
  // a template. See ../templates.md for the cache pattern.
});

receiver.on("error", (err, event) => {
  console.error("[receiver] handler failed", { err, eventId: (event as { id?: string }).id });
});

const app = express();
app.use("/webhooks/whatsapp", createWhatsAppMiddleware(receiver));
app.listen(3000);

// ───────── consumer-side primitives (sketches) ─────────

async function isEscalated(phoneNumberId: string, customerWaId: string): Promise<boolean> {
  // Look up the conversation state in your store.
  return false;
}

async function escalate(phoneNumberId: string, event: MessageEvent, reason: string) {
  // 1. Mark the conversation as escalated in your store (so the bot
  //    stops replying).
  // 2. Push a handoff packet to your HITL inbox queue.
  // 3. Optionally send a templated "a teammate will be with you
  //    shortly" message via client.sendTemplate.
}

async function classifyIntent(text: string) {
  // your LLM call (Haiku) — narrow to known intents + "unknown"
  return { kind: "unknown" as const };
}

async function detectEscalation(text: string, event: MessageEvent) {
  // your LLM call (Haiku) — return { shouldEscalate, reason }
  return { shouldEscalate: false, reason: "" };
}

async function draftReply(
  intent: { kind: string },
  text: string,
  event: MessageEvent
): Promise<string | undefined> {
  // your LLM call (Sonnet) — generate the reply
  return "Thanks — I'll get back to you shortly.";
}

function textOf(e: MessageEvent): string {
  if (e.type !== "text") return "";
  return (e.body.text as { body?: string } | undefined)?.body ?? "";
}
```

## The handoff packet

When you escalate, the human receiving the conversation in the HITL
inbox needs full context. The packet should at minimum include:

- The customer's `wa_id` and any profile name from the event.
- The full conversation history from your store (ordered, with
  timestamps and sender).
- The escalation `reason` from the detector.
- The bot's _last drafted but unsent_ reply if any (so the human can
  decide whether to send it as-is, edit, or write fresh).
- Span IDs from the OTel context, so the human-side actions correlate
  with the bot-side work.

The minimum-fields list above is enough to deliver a customer to a
human without context loss; richer schemas are the consumer's call.

## Things that bite

- **Don't generate bot replies after escalation.** Check the
  conversation's escalation flag at the _top_ of every handler. The
  HITL inbox writes back through the SDK; if the bot also writes,
  customers see two voices.
- **Don't include the SDK's outbound spans inside your LLM-call
  spans.** They're parallel. Wrap LLM calls in `withSpan("bot.draft",
...)`; the SDK creates its own `whatsapp.request` span when you
  call `client.sendText`.
- **Don't escalate on every `unknown` intent.** Most "unknown"s are
  fine and the bot should ask a clarifying question. Escalate on
  signals (frustration, repeated re-prompts, explicit "agente"
  request, sentiment shift). The Danissa baseline failed precisely by
  _not_ doing this.
- **Don't await `dispatchPromise` inside the Express handler.** The
  middleware acks 200 first and runs handlers async; LLM calls take
  seconds.
- **Don't trust the LLM's claimed escalation decision blindly in
  prod.** Audit-sample escalations and re-prompt the model when its
  precision degrades.

## Where to go from here

- **Conversation state**: your shape probably wants slot extraction
  on top of intent. The
  [Appointment booking](./appointment-booking.md) recipe covers slot
  collection.
- **Multi-tenant**: same shape, different tenants. See
  [Multi-tenant](./multi-tenant.md).
- **Patterns**: the escalation step here is one of the patterns in
  [`../patterns.md`](../patterns.md#3-escalation-to-hitl). If you want
  the rate-limit-aware queue or the token-rotation pattern as
  standalone primitives, they live there.
