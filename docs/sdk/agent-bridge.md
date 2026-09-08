# Agent bridge (`agent-bridge`)

The agent bridge is the missing primitive between the SDK's
push-based inbound (`WebhookReceiver`) and the request/response
nature of any agent runtime (Claude Agent SDK, langchain, your
own loop). It standardises the 50–80 lines of glue every
hybrid-pattern consumer writes by hand.

Spec: [`openspec/specs/agent-bridge/spec.md`](../../openspec/specs/agent-bridge/spec.md).
Source: [`packages/whatsapp-sdk/src/agent-bridge/`](../../packages/whatsapp-sdk/src/agent-bridge/).

## Public exports

```ts
import {
  createAgentBridge,
  InMemoryAgentInbox,
  defaultAgentTransform,
  type AgentBridge,
  type AgentInbox,
  type AgentTask,
  type AgentTaskTransform,
  type CreateAgentBridgeInput,
  type TakeoverCheck,
} from "@dojocoding/whatsapp-sdk";
```

## Minimum usage

```ts
const receiver = new WebhookReceiver({ appSecret, verifyToken });
const client = new WhatsAppClient({ phoneNumberId, wabaId, token, appSecret });
const inbox = new InMemoryAgentInbox();

createAgentBridge({ receiver, client, inbox });

// Wire receiver into your HTTP layer as usual.
// Later, your agent runner reads from `inbox.tasks`.
```

That's the whole API. Everything else is opt-in configuration.

## What the bridge does on every inbound message

In strict order:

1. **`windowTracker.notifyInbound(event.from)`** — if a tracker
   is supplied. This is the most-forgotten line in every
   hybrid cookbook; auto-firing protects against the classic
   "all my replies fail with `WindowClosedError`" bug.
2. **`isOnTakeover(event)`** — if supplied. Returning truthy
   short-circuits the rest of the dispatch (no ack, no enqueue).
   The HITL inbox is expected to handle acks itself.
3. **`client.markAsRead({ messageId, typing })`** — fire-and-
   forget. The customer sees two blue ticks + a typing
   indicator in <100 ms, before the agent emits its first
   token. Failures route through `onError` and are swallowed.
4. **`transform(event)`** — `null` skips enqueue. Default
   transform is `defaultAgentTransform`.
5. **`inbox.append(task)`** — `await`ed. Failures route through
   `onError` and are swallowed (Meta's 30 s ack rule wins).

## Configuration

```ts
createAgentBridge({
  receiver,
  client,
  inbox,

  // Optional — auto-refreshes the 24h window on every inbound.
  windowTracker,

  // Optional — when truthy, skips ack + enqueue.
  isOnTakeover: (event) => hitl.isOnTakeover(event.from),

  // Optional — defaults to defaultAgentTransform.
  transform: (event) => ({ ...defaultAgentTransform(event), tenantId: lookup(event) }),

  // Default true. Set false when your inbox handles the ack itself.
  autoMarkRead: true,

  // Default true. Set false when you don't want the typing indicator.
  autoTyping: true,

  // Optional — fires on inbox / ack / takeover failures.
  onError: (err, event) => log.warn({ err, event }, "agent-bridge"),
});
```

## The `AgentTask` shape

The bundled transform produces:

```ts
interface AgentTask {
  receivedAt: number; // ms epoch
  wabaPhoneNumberId?: string;
  conversationId: string; // defaults to from
  from: string;
  wamid: string;
  type: IncomingMessageKind;

  text?: string; // text messages
  mediaIds?: ReadonlyArray<string>; // image / video / audio / document / sticker
  buttonReplyId?: string; // interactive_button_reply
  listReplyId?: string; // interactive_list_reply
  location?: { latitude; longitude; name?; address? };

  replyToWamid?: string; // context.id
  windowOpen?: boolean; // set when a windowTracker is configured
  ctwaReferral?: WhatsAppReferral & Record<string, unknown>;

  raw: MessageEvent; // escape hatch for fields the transform omits
}
```

`raw` is intentionally provided — the default transform covers
the front-desk pattern, but Meta's inbound shape is rich. When
you need a field the default skips (an order, a reaction, a
system event), reach into `task.raw`.

## Pluggable inbox

`AgentInbox` is one async method:

```ts
interface AgentInbox {
  append(task: AgentTask): Promise<void>;
}
```

`InMemoryAgentInbox` is the only ship-default. Production
deployments implement against their queue backend — same
posture as `Storage`. The bridge does NOT manage inbox
lifecycle.

### Redis Streams (consumer-side)

```ts
import { Redis } from "ioredis";

class RedisStreamsInbox implements AgentInbox {
  constructor(
    private readonly redis: Redis,
    private readonly stream = "agent:inbox"
  ) {}
  async append(task: AgentTask): Promise<void> {
    await this.redis.xadd(this.stream, "*", "task", JSON.stringify(task));
  }
}
```

Pair with `XREADGROUP` in the agent runner process. Redis
Streams handle dedup-by-id, consumer groups, and replay — all
out of scope for the bridge.

### Postgres LISTEN/NOTIFY (consumer-side)

```ts
class PgListenInbox implements AgentInbox {
  constructor(private readonly pool: Pool) {}
  async append(task: AgentTask): Promise<void> {
    await this.pool.query("SELECT pg_notify('agent_inbox', $1)", [JSON.stringify(task)]);
  }
}
```

Cheapest at low volume; production agent runners listen on
the channel.

## HITL takeover

Pass `isOnTakeover` and the bridge skips both the auto-ack and
the enqueue when a human is in control. The reasoning is in
[`docs/cookbook/hybrid/typing-while-thinking.md`](../cookbook/hybrid/typing-while-thinking.md)
§ HITL takeover carve-out.

## Disposal

`createAgentBridge` returns `{ dispose }`. Call it to detach
the receiver handler — useful in tests and when re-configuring
mid-process:

```ts
const bridge = createAgentBridge({ receiver, client, inbox });
// …
bridge.dispose(); // idempotent
```

## What the bridge does NOT do

- **Run your agent.** The bridge enqueues tasks; the agent
  runner is separate.
- **Persist conversation state.** Use
  `@dojocoding/conversation-state` or your own store.
- **Ship Redis / Postgres / SQS adapters.** Only the
  in-memory inbox ships. Adapters are 5-line classes; the
  recipes above are the canonical patterns.
- **Route status webhooks.** Attach your own
  `receiver.on("status", h)` — that traffic doesn't belong in
  the agent inbox.
- **Throttle the agent.** Backpressure is the inbox's job (the
  queue backend handles it).

## See also

- [`docs/cookbook/hybrid/agent-handoff-loop.md`](../cookbook/hybrid/agent-handoff-loop.md)
  — the wider loop the bridge sits inside.
- [`docs/cookbook/hybrid/typing-while-thinking.md`](../cookbook/hybrid/typing-while-thinking.md)
  — the UX pattern the bridge auto-implements.
- [`docs/sdk/window.md`](./window.md) — the tracker the bridge
  auto-notifies.
- [`docs/sdk/messages.md`](./messages.md) — the send surface
  the agent calls back through.
