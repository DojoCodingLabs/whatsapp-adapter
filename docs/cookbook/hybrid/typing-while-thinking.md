# Typing while thinking — the agent-loop UX baseline

The single biggest perceived-quality lever for an agentic
WhatsApp bot is **what the customer sees while the LLM is
generating**. The wrong answer (silence, then a wall of text)
makes a 4-second response feel broken. The right answer (two
blue ticks → "typing…" → reply) makes the same 4 seconds feel
fast.

This recipe documents the canonical pattern using
`client.markAsRead({ messageId, typing: true })` (shipped in
`sdk-v1.1.0`).

## The pattern

```ts
import { WhatsAppClient, WebhookReceiver, WindowTracker } from "@dojocoding/whatsapp-sdk";

const receiver = new WebhookReceiver({ appSecret, verifyToken });
const tracker = new WindowTracker({ phoneNumberId, storage });
const client = new WhatsAppClient({
  phoneNumberId,
  wabaId,
  token,
  appSecret,
  windowTracker: tracker,
});

receiver.on("message", async (event) => {
  // 1. Open the 24h window. Single most-forgotten line in the codebase.
  await tracker.notifyInbound(event.from, event.timestamp);

  // 2. Ack the customer IMMEDIATELY. Fire-and-forget — DO NOT await.
  //    Two blue ticks + "typing…" land in <100 ms, before token #1.
  void client
    .markAsRead({ messageId: event.id, typing: true })
    .catch((err) => log.warn({ err }, "markAsRead failed"));

  // 3. Generate the reply. 2–10 s of LLM work is fine — the customer
  //    is watching the typing indicator, not the silence.
  const reply = await agent.respond(event);

  // 4. Send. Typing indicator auto-clears on this call.
  await client.sendText({
    to: event.from,
    body: reply,
    replyTo: event.id,
  });
});
```

## Three things engineers get wrong the first time

### 1. `await`ing the ack

```ts
// ❌ Wrong — adds an HTTP round-trip to every reply
await client.markAsRead({ messageId: event.id, typing: true });
const reply = await agent.respond(event);

// ✅ Right — fire-and-forget; ack races the LLM call
void client.markAsRead({ messageId: event.id, typing: true }).catch(noop);
const reply = await agent.respond(event);
```

The ack is best-effort UX glue. If it fails — Meta rate-limited
your number, your token rotated, transient 5xx — you still want
to deliver the reply. `await`ing makes ack failure block the
reply path. Fire-and-forget is the right shape.

The `.catch(noop)` is required so Node doesn't fire an
`unhandledRejection` warning on the rare failure case.

### 2. Typing indicator that times out mid-thought

Meta auto-dismisses the typing indicator **after ~25 seconds**
or on send-reply, whichever comes first. If your agent takes
longer (multi-tool call, complex RAG, slow inference), the
customer sees "typing…" disappear, then a long silence, then
the reply — worse than no typing indicator at all.

For long-running thinks, keep it alive:

```ts
async function keepTypingAlive(
  client: WhatsAppLikeClient,
  messageId: string,
  signal: AbortSignal
): Promise<void> {
  // Re-ack every 20 s while the agent is busy. Stops on abort.
  while (!signal.aborted) {
    void client.markAsRead({ messageId, typing: true }).catch(() => {});
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

receiver.on("message", async (event) => {
  await tracker.notifyInbound(event.from, event.timestamp);
  void client.markAsRead({ messageId: event.id, typing: true }).catch(() => {});

  const ac = new AbortController();
  void keepTypingAlive(client, event.id, ac.signal);
  try {
    const reply = await agent.respond(event);
    await client.sendText({ to: event.from, body: reply, replyTo: event.id });
  } finally {
    ac.abort();
  }
});
```

Threshold to add the keepalive loop: any agent path where the
**p95 response time exceeds 15 seconds**. Below that, the
single-shot ack is enough.

### 3. Typing indicator on voice notes

If the customer sends a voice note, transcription typically
takes 1–4 s before the agent even starts thinking, and the
total round-trip is often 10–20 s. The typing indicator paired
with a voice-note ack feels off — voice notes have their own
"playing/processing" UI on the customer's side, and the typing
state competes with it.

The cleaner pattern for voice:

```ts
if (event.type === "audio") {
  // Ack with read but NO typing — voice has its own UX cue
  void client.markAsRead({ messageId: event.id }).catch(() => {});
  // ... transcribe, generate, reply
} else {
  // Text / image / button — typing indicator is right
  void client.markAsRead({ messageId: event.id, typing: true }).catch(() => {});
  // ...
}
```

## HITL takeover carve-out

When a human operator opens the conversation in your inbox UI,
**the bot should stop everything** — including the auto-ack.
Otherwise, the customer sees "typing…" from the bot while
the operator is also typing, and the two responses collide.

Check the takeover state BEFORE the ack:

```ts
receiver.on("message", async (event) => {
  await tracker.notifyInbound(event.from, event.timestamp);

  if (await hitl.isOnTakeover(event.from)) {
    // The human's inbox handles the ack + reply. Bot is silent.
    return;
  }

  void client.markAsRead({ messageId: event.id, typing: true }).catch(() => {});
  // ... rest of the agent loop
});
```

## Using the `agent-bridge` primitive

If you're using `createAgentBridge` (the canonical front-desk
plumbing), the auto-ack + typing pattern is **baked in by
default** — you don't write the `markAsRead` call yourself:

```ts
import { createAgentBridge, InMemoryAgentInbox } from "@dojocoding/whatsapp-sdk";

const inbox = new InMemoryAgentInbox(); // or your Redis-Streams inbox

createAgentBridge({
  receiver,
  client,
  inbox,
  windowTracker: tracker,
  isOnTakeover: (event) => hitl.isOnTakeover(event.from),
  // autoMarkRead defaults to true
  // autoTyping defaults to true
});
```

The bridge handles all three correctness points (fire-and-forget,
HITL gate, window-tracker auto-notify) for you. If you want a
voice-note carve-out, override the auto-typing behaviour with a
custom transform that calls `markAsRead` itself with the right
shape and sets `autoMarkRead: false` on the bridge.

See [`docs/sdk/agent-bridge.md`](../../sdk/agent-bridge.md) for
the full bridge reference and
[`agent-handoff-loop.md`](./agent-handoff-loop.md) for the wider
loop this pattern sits inside.

## What about read receipts without typing?

Same call, just drop the `typing` flag:

```ts
await client.markAsRead({ messageId: event.id });
```

The customer sees the two blue ticks but no typing indicator.
Use this when:

- The bot is acknowledging an event it's not going to respond
  to immediately (queued for batch processing, deferred to
  business hours, escalated to HITL).
- You're processing the inbound for analytics/logging only.
- The agent's response time is genuinely instant (rule-based
  reply, cached lookup) — sub-200 ms — so the typing indicator
  flashing on and off looks worse than no indicator.

## What it costs

Read receipts and typing indicators do NOT count against your
MPS quota — Meta documents them as conversation-management
operations, not messages. The HTTP round-trip is ~50–150 ms
to `graph.facebook.com`, fire-and-forget, no rate-limit impact.

This is one of the few free UX upgrades the Cloud API gives
you. Ship it.
