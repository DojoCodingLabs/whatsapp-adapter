# Inbound routed to agent

The [`agent-handoff-loop.md`](./agent-handoff-loop.md) recipe
starts from "agent kicks off the conversation". This one starts
from "customer messages us first; decide whether to engage an
agent".

Useful when:

- Most inbound messages can be handled by canned automation
  (FAQ, status checks, automated booking) and you only want to
  escalate the tricky ones to an LLM agent.
- You want to apply privacy or cost controls — not every inbound
  should go into an LLM's context window.
- You're running multi-product: different intents route to
  different agents.

## Architecture

```
   Meta webhook ─▶ WebhookReceiver
                       │
                       ▼
              intent classifier (LLM call OR rules)
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
   automated      MCP agent       human queue
   SDK reply      (escalate)      (out-of-scope)
```

## Step 1 — receive + classify

The receiver fires on every inbound. Before doing anything else,
classify the intent:

```ts
import { WebhookReceiver, type MessageInboundEvent } from "@dojocoding/whatsapp-sdk";

type Intent =
  | "faq" // automated reply via SDK
  | "agent" // hand off to LLM
  | "human" // park for a human operator
  | "ignore"; // spam, opt-outs, etc.

async function classify(event: MessageInboundEvent): Promise<Intent> {
  const body = event.message.type === "text" ? event.message.text : "";

  // Cheap rule-based shortcuts first.
  if (/^stop$/i.test(body)) return "ignore"; // STOP keyword
  if (/^(hi|hello|hola)\b/i.test(body)) return "faq"; // greeting
  if (/order\s+#?\d+/i.test(body)) return "agent"; // order lookup
  if (event.message.type !== "text") return "agent"; // media → agent

  // Fallback: a fast classifier (e.g. Claude Haiku) for ambiguous text.
  const cls = await fastClassifier(body);
  return cls.intent;
}
```

The rules-first / LLM-fallback shape keeps cost down — the LLM
only runs on messages that aren't trivially classifiable. The
fast classifier can be a tiny prompt to Haiku:

```ts
async function fastClassifier(body: string): Promise<{ intent: Intent }> {
  // Pseudo-code; adapt to your Anthropic SDK.
  const reply = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 10,
    system: `Classify the customer message into one of: faq, agent, human, ignore. Reply with one word.`,
    messages: [{ role: "user", content: body }],
  });
  const text = (reply.content[0] as { text?: string }).text?.toLowerCase().trim();
  if (text === "faq" || text === "agent" || text === "human" || text === "ignore") {
    return { intent: text };
  }
  return { intent: "agent" }; // safe default: escalate
}
```

## Step 2 — route to the right handler

```ts
receiver.on("message", async (event) => {
  await windowTracker.notifyInbound(event.from);

  const intent = await classify(event);
  switch (intent) {
    case "faq":
      await handleFaq(event);
      break;
    case "agent":
      await handleAgent(event);
      break;
    case "human":
      await parkForHuman(event);
      break;
    case "ignore":
      break;
  }
});
```

### `faq` — automated reply via the SDK

No agent involvement. Direct SDK call:

```ts
async function handleFaq(event: MessageInboundEvent): Promise<void> {
  const lower = (event.message.type === "text" ? event.message.text : "").toLowerCase();
  let reply: string;
  if (lower.includes("hours")) reply = "We're open Mon-Fri 9 AM-6 PM PT.";
  else if (lower.includes("price")) reply = "See https://example.com/pricing";
  else reply = "Thanks for messaging! Reply 'help' to talk to support.";

  await client.sendText({ to: event.from, body: reply });
}
```

Cheap, fast, no LLM cost.

### `agent` — hand off to the LLM

Same pattern as
[`agent-handoff-loop.md`](./agent-handoff-loop.md): append to
the agent's conversation, or fire a one-shot Claude run with
the MCP tools available.

```ts
async function handleAgent(event: MessageInboundEvent): Promise<void> {
  const body = event.message.type === "text" ? event.message.text : `[${event.message.type}]`;
  await agent.appendUserMessage(
    `Customer ${event.from} (${event.profileName ?? "unknown"}) sent: ${body}. ` +
      `Reply via the WhatsApp MCP tools.`
  );
}
```

### `human` — park for a human operator

No automated reply. Push to a queue / Slack channel / your
support tool:

```ts
async function parkForHuman(event: MessageInboundEvent): Promise<void> {
  await slack.sendMessage("#wa-support", {
    text: `New ticket from ${event.from}: ${describe(event)}`,
  });
  // Optionally: ack to the customer so they know we received it.
  await client.sendText({
    to: event.from,
    body: "Got it — a human will reply within 30 minutes.",
  });
}
```

## When the classifier itself is the agent

For higher-end use cases, the classifier and the agent are the
same Claude session — Claude reads the inbound, decides what to
do, and either (a) calls a tool to send an automated reply,
(b) takes over the conversation, or (c) escalates to a human.

```ts
async function handleInbound(event: MessageInboundEvent): Promise<void> {
  await agent.appendUserMessage(`
    Customer ${event.from} sent: "${event.message.type === "text" ? event.message.text : `[${event.message.type}]`}".

    Decide what to do:
    - For FAQ-style questions, send a short text reply via whatsapp_send_text.
    - For order / account / personalised questions, engage in a multi-turn
      conversation (also via whatsapp_send_text).
    - For anything you can't help with, reply that a human will follow up,
      then output the marker "ESCALATE_TO_HUMAN" for our pipeline to pick up.
  `);
}
```

This collapses the rule-and-classifier layers into the agent
itself. Higher per-message cost (every inbound goes through
Claude) but lower engineering overhead.

## Privacy considerations

The classifier-first pattern is also a **privacy boundary**.
Inbound messages classified as `faq` or `human` never reach the
LLM. That's useful if:

- Your customers send PII (medical, financial, government) that
  you don't want flowing through Anthropic's API.
- You have a privacy policy that promises certain inputs aren't
  used for AI processing.

The rules layer handles those cases; the LLM only sees the
escalation pool.

## Cost back-of-envelope

For a hypothetical 1000 inbounds/day:

- All rules + tiny LLM classifier: ~200 LLM calls × Haiku tokens
  = ~$0.10/day. Per-inbound: $0.0001.
- Pure LLM classifier (every message): ~1000 calls × Haiku = ~$0.50/day.
- Agent-on-every-inbound: ~1000 multi-turn conversations × Sonnet
  = $50+/day.

The classifier-first pattern is two orders of magnitude cheaper
than the agent-on-every-inbound pattern.

## See also

- [`agent-handoff-loop.md`](./agent-handoff-loop.md) — the
  canonical agent loop (use this for outbound-first patterns).
- [`compliance-broadcast.md`](./compliance-broadcast.md) —
  consent-ledger enforcement on agent-triggered sends.
- [`docs/sdk/webhooks.md`](../../sdk/webhooks.md) — webhook
  receiver reference.
