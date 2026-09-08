# Cookbook — Agent bridge over Redis Streams

The canonical production wiring for the hybrid front-desk
pattern: webhook receiver in one process, agent runtime in
another, Redis Streams as the queue between them. Built on
`createAgentBridge` + `InMemoryAgentInbox`'s sibling pattern,
a `RedisStreamsInbox`.

This recipe is the missing piece that closes the loop on
[`../../sdk/agent-bridge.md`](../../sdk/agent-bridge.md): the
SDK ships only the in-memory inbox; production deployments
ship the queue backend.

## When you need this

- The webhook receiver and the agent runtime run in separate
  processes (webhook is a thin HTTP server; agent is a
  long-lived worker pool with model warm-up).
- You need persistence — webhook restarts shouldn't lose
  in-flight tasks.
- You need replay — an agent crash should resume from the
  last-acked task, not the latest.
- You're horizontally scaling the agent runner across N
  workers.

If your receiver and agent run in one process and you don't
need persistence, `InMemoryAgentInbox` is fine. If you need a
hosted-queue alternative, the same pattern applies to BullMQ,
AWS SQS, or Postgres LISTEN/NOTIFY — only the four primitive
calls change.

## Why Redis Streams (vs Pub/Sub, vs BullMQ)

Redis Streams give you three things `XPUB/XSUB` and basic
queues don't:

1. **Consumer groups** — multiple workers pull from one
   stream, each task lands at exactly one worker.
2. **Persistence + replay** — tasks live on disk; `XREADGROUP`
   with `>` picks up where the consumer left off after a
   restart.
3. **Per-task acknowledgement** — `XACK` is explicit. If a
   worker crashes mid-process, the task returns to the
   pending-entries list and another worker picks it up.

BullMQ wraps Redis Streams with a richer feature set
(scheduled jobs, repeatable jobs, rate-limited workers). Use
BullMQ when you want that surface; use raw Streams when you
want the minimum primitive.

## The flow

```
┌─────────────────────────┐         ┌──────────────────────────┐
│  Webhook receiver       │         │  Agent worker(s)         │
│  process                 │         │  process                 │
│                          │         │                          │
│  receiver.on("message")  │         │  XREADGROUP              │
│    │                     │         │   │                      │
│    ▼                     │         │   ▼                      │
│  createAgentBridge       │  XADD   │  parse AgentTask         │
│    │                     │ ────▶   │   │                      │
│    ▼                     │         │   ▼                      │
│  RedisStreamsInbox       │         │  agent.respond(task)     │
│    │                     │         │   │                      │
│    ▼                     │         │   ▼                      │
│  XADD agent:inbox * task │         │  XACK + client.sendText  │
└─────────────────────────┘         └──────────────────────────┘
```

The webhook process owns the SDK client for inbound
acknowledgements; the agent process owns the same client for
outbound replies. Both processes are bound to the same
WABA-phone pair via the same env vars.

## Step 1: RedisStreamsInbox (webhook side)

```ts
// lib/redis-streams-inbox.ts
import type { Redis } from "ioredis";

import type { AgentInbox, AgentTask } from "@dojocoding/whatsapp-sdk";

export interface RedisStreamsInboxOptions {
  /** Stream key. Defaults to "agent:inbox". */
  stream?: string;
  /**
   * MAXLEN cap on the stream. Approximate trimming (`~`) is
   * fine — Redis trims in bulk and the bound is loose. Defaults
   * to 100_000 (a few days of front-desk traffic at typical
   * volumes).
   */
  maxLen?: number;
}

export class RedisStreamsInbox implements AgentInbox {
  readonly #redis: Redis;
  readonly #stream: string;
  readonly #maxLen: number;

  constructor(redis: Redis, options: RedisStreamsInboxOptions = {}) {
    this.#redis = redis;
    this.#stream = options.stream ?? "agent:inbox";
    this.#maxLen = options.maxLen ?? 100_000;
  }

  async append(task: AgentTask): Promise<void> {
    // XADD agent:inbox MAXLEN ~ <maxLen> * task <serialized>
    // Approximate MAXLEN keeps the stream bounded without
    // forcing exact-trim cost on every write.
    await this.#redis.xadd(
      this.#stream,
      "MAXLEN",
      "~",
      this.#maxLen,
      "*",
      "task",
      JSON.stringify(task)
    );
  }
}
```

### Wire it into the bridge

```ts
// webhook-server.ts
import { Redis } from "ioredis";
import {
  WhatsAppClient,
  WebhookReceiver,
  WindowTracker,
  createAgentBridge,
  createRedisStorage,
} from "@dojocoding/whatsapp-sdk";

import { RedisStreamsInbox } from "./lib/redis-streams-inbox.js";

const redis = new Redis(process.env.REDIS_URL!);
const storage = createRedisStorage(redis);
const tracker = new WindowTracker({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  storage,
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
  storage, // shared with the tracker for dedup
});

createAgentBridge({
  receiver,
  client,
  inbox: new RedisStreamsInbox(redis),
  windowTracker: tracker,
  onError: (err) => logger.warn({ err }, "agent-bridge"),
});

// Mount the receiver into your HTTP framework
// (express / hono / web / next App Router) as usual.
```

That's the entire webhook process. The agent runs separately.

## Step 2: Consumer group setup (one-time)

Run this once when you provision the deployment — typically
in a migration script or container init:

```ts
// scripts/redis-init.ts
import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_URL!);

// Create the consumer group. `MKSTREAM` creates the stream
// if it doesn't exist yet — useful for fresh deployments.
// The `$` starts the group at the current tail; workers will
// only see tasks XADD'd AFTER this call. Use `0` instead to
// replay the full stream (e.g. for re-processing).
try {
  await redis.xgroup("CREATE", "agent:inbox", "front-desk", "$", "MKSTREAM");
} catch (err) {
  // BUSYGROUP means the group already exists — idempotent setup.
  if (!(err instanceof Error) || !err.message.includes("BUSYGROUP")) throw err;
}

await redis.quit();
```

If you scale to multiple deployments, each one wants its own
consumer group name. The stream is shared, the group is the
"who's reading" identity.

## Step 3: Agent worker (consumer side)

```ts
// agent-worker.ts
import { Redis } from "ioredis";
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
import type { AgentTask } from "@dojocoding/whatsapp-sdk";

const redis = new Redis(process.env.REDIS_URL!);
const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  token: process.env.WHATSAPP_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
});

const STREAM = "agent:inbox";
const GROUP = "front-desk";
const CONSUMER = `worker-${process.env.HOSTNAME ?? process.pid}`;
const BLOCK_MS = 5_000;
const BATCH = 16;

async function runLoop(): Promise<void> {
  for (;;) {
    // XREADGROUP GROUP <group> <consumer> COUNT <n> BLOCK <ms>
    //   STREAMS agent:inbox >
    // The `>` selects "messages never delivered to this group
    // before". Pending-entries (PEL) are recovered via XCLAIM
    // — see step 4 below.
    const result = await redis.xreadgroup(
      "GROUP",
      GROUP,
      CONSUMER,
      "COUNT",
      BATCH,
      "BLOCK",
      BLOCK_MS,
      "STREAMS",
      STREAM,
      ">"
    );
    if (!result) continue; // BLOCK timeout — loop again

    // Each `entry` is [streamName, [[messageId, fields[]], …]]
    const entries = (result as Array<[string, Array<[string, string[]]>]>)[0]?.[1] ?? [];

    await Promise.all(
      entries.map(async ([messageId, fields]) => {
        // fields is a flat KV array: ["task", "{json}"]
        const taskJson = fields[1];
        if (!taskJson) {
          await redis.xack(STREAM, GROUP, messageId);
          return;
        }
        try {
          const task = JSON.parse(taskJson) as AgentTask;
          await processTask(task);
          await redis.xack(STREAM, GROUP, messageId);
        } catch (err) {
          // Do NOT XACK on failure — Redis keeps the task in
          // the consumer's PEL, where XCLAIM will recover it.
          logger.error({ err, messageId }, "task failed; leaving in PEL");
        }
      })
    );
  }
}

async function processTask(task: AgentTask): Promise<void> {
  const reply = await agent.respond(task);
  await client.sendText({
    to: task.from,
    body: reply,
    replyTo: task.wamid,
  });
}

void runLoop();
```

Run N copies of `agent-worker.ts` behind a supervisor (k8s
Deployment, Fly Machines, PM2 cluster mode, whatever). Each
consumer has a unique `CONSUMER` id; the group distributes
tasks across them.

## Step 4: PEL recovery (handling crashed workers)

When a worker crashes mid-task, its in-flight tasks stay in
the **pending entries list** (PEL) for that consumer. A
second loop reclaims them after an idle threshold:

```ts
const IDLE_MS = 60_000; // claim tasks idle for >1 minute

async function reclaimStaleTasks(): Promise<void> {
  for (;;) {
    // XAUTOCLAIM is the modern, atomic alternative to the
    // older XPENDING + XCLAIM combo. Returns up to COUNT
    // entries that have been idle for at least <min-idle-time>
    // and re-assigns them to <CONSUMER>.
    const result = await redis.xautoclaim(
      STREAM,
      GROUP,
      CONSUMER,
      IDLE_MS,
      "0", // cursor; "0" starts from the beginning
      "COUNT",
      16
    );
    // [nextCursor, entries[], deletedIds[]]
    const entries = (result as [string, Array<[string, string[]]>, string[]])[1];
    for (const [messageId, fields] of entries) {
      try {
        const task = JSON.parse(fields[1] ?? "{}") as AgentTask;
        await processTask(task);
        await redis.xack(STREAM, GROUP, messageId);
      } catch (err) {
        logger.error({ err, messageId }, "reclaim failed");
      }
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

void reclaimStaleTasks(); // alongside runLoop
```

Tune `IDLE_MS` to a value bigger than your p99 agent response
time. Too short and healthy workers' tasks get re-assigned
mid-flight (the agent fires twice).

## Step 5: Dead-letter handling

After N reclaim attempts, a task is poison — likely a parse
error or an agent bug that will fail forever. Move it to a
dead-letter stream rather than retry indefinitely:

```ts
async function processWithDLQ(messageId: string, task: AgentTask): Promise<void> {
  // Pull delivery count from XPENDING
  const pending = (await redis.xpending(STREAM, GROUP, messageId, messageId, 1)) as Array<
    [string, string, number, number]
  >;
  const deliveries = pending[0]?.[3] ?? 0;

  if (deliveries > 5) {
    await redis.xadd("agent:inbox:dlq", "*", "task", JSON.stringify(task), "reason", "max-retries");
    await redis.xack(STREAM, GROUP, messageId);
    logger.error({ messageId, task }, "moved to DLQ");
    return;
  }

  await processTask(task);
  await redis.xack(STREAM, GROUP, messageId);
}
```

Then run a separate monitoring process that alerts on
`XLEN agent:inbox:dlq > 0` so a human investigates.

## Observability

Useful Redis CLI queries while debugging:

```bash
# How big is the backlog?
redis-cli XLEN agent:inbox

# How many tasks are in-flight (pending across all consumers)?
redis-cli XPENDING agent:inbox front-desk

# Per-consumer breakdown
redis-cli XINFO CONSUMERS agent:inbox front-desk

# Inspect the most recent N tasks (read-only, doesn't consume)
redis-cli XRANGE agent:inbox - + COUNT 10
```

For Grafana / Datadog dashboards, the metrics worth tracking
per consumer group:

- `XLEN(agent:inbox)` — backlog depth
- `XPENDING(agent:inbox, front-desk).count` — in-flight count
- `XPENDING(agent:inbox, front-desk).max_idle_ms` — slowest
  in-flight task (early signal of stuck worker)
- `XLEN(agent:inbox:dlq)` — dead-letter count (page on
  non-zero)

The SDK's OTel spans on the outbound `sendText` calls give
you per-reply latency; pair those with the queue metrics
above and you have full observability.

## Gotchas

- **Don't `XACK` before the agent has finished and sent.**
  If you ack on receive and the worker crashes mid-process,
  the customer never gets a reply. Ack only after the
  send succeeds.
- **`MAXLEN ~` vs `MAXLEN`.** The `~` is approximate trim
  (Redis trims in bulk; the bound is loose). Without `~`,
  every XADD checks the exact length, which is O(n) on the
  cap value. Always use `~` unless you genuinely need an
  exact bound.
- **One stream per WABA-phone pair**, not one stream for
  everything. Multi-tenant deployments prefix the stream key
  with the phone number id (`agent:inbox:PNID-123`). Sharing a
  stream across tenants makes per-tenant pause / drain /
  replay impossible.
- **Connection pooling.** `ioredis` keeps a single TCP
  connection per client by default. For high-throughput
  webhook processes, the bridge's `inbox.append` is on the
  hot path — share one `Redis` instance across the receiver
  and the storage adapter (as in step 1) rather than creating
  one per call.
- **TLS in production.** Most managed Redis providers
  (Upstash, Redis Cloud, AWS ElastiCache with in-transit
  encryption) require TLS. `new Redis(url)` with a `rediss://`
  URL is the canonical opt-in.

## See also

- [`../../sdk/agent-bridge.md`](../../sdk/agent-bridge.md) —
  the primitive this inbox plugs into.
- [`./multi-tenant.md`](./multi-tenant.md) — the stream-per-
  tenant pattern for multi-WABA deployments.
- [`../hybrid/agent-handoff-loop.md`](../hybrid/agent-handoff-loop.md)
  — the wider loop this queue sits inside.
- [`../hybrid/orchestrator-process-layout.md`](../hybrid/orchestrator-process-layout.md)
  — alternative single-process scaffold for when you don't
  need the cross-process boundary.
