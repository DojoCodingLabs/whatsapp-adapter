# Outbound queue (`outbound-queue`)

In-process rate-limited send queue. Wraps any `WhatsAppLikeClient`
and throttles `send*` calls so they respect Meta's per-pair and
per-WABA ceilings _before_ issuing the HTTP request — preventing
the burst that produces `RateLimitError (131056)` rather than just
recovering from it via the retry loop.

Spec: [`openspec/specs/outbound-queue/spec.md`](../openspec/specs/outbound-queue/spec.md).
Source: [`packages/whatsapp-sdk/src/queue/`](../src/queue/).

## Quick start

```ts
import { WhatsAppClient, withRateLimit } from "@dojocoding/whatsapp-sdk";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  token: process.env.WHATSAPP_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
});

const queued = withRateLimit(client, {
  perPair: { messages: 1, per: 6_000 }, // default
  perWaba: { mps: 80 }, // default; raise as Meta grants higher tiers
});

await queued.sendText({ to: "+5210000000001", body: "hi" });
//   ^ identical surface — the queue is caller-invisible
```

## What gets queued

Every `send*` method on the wrapped client. The decorator extracts
the recipient (`input.to` for standard sends, `payload.to` for
`sendReply`), then `await`s two token-bucket acquisitions:

1. **Per pair** — bucket keyed by `${client.phoneNumberId}:${to}`.
   Default: 1 message per 6 seconds (matches Meta's documented
   ceiling for unsolicited free-form sends).
2. **Per WABA** — bucket keyed by `client.wabaId`. Default: 80 MPS
   (verified-tier starting limit; raise as you're granted higher
   tiers).

Both ceilings must clear before the call delegates to the wrapped
client. The wrapped client's own retry policy is still active and
handles the rare 429 that slips through (e.g. multi-process
deployments where another process shares the phone).

## What does NOT get queued

`isWindowOpen`, `listTemplates`, and `getTemplate` pass through
unchanged — they don't count against Meta's send ceilings.

The decorator does NOT touch the wrapped client's internal state.
You can wrap the same client multiple times for multiple workloads;
each decorator has independent buckets.

## Options

```ts
const queued = withRateLimit(client, {
  perPair: { messages: 1, per: 6_000 },
  perWaba: { mps: 80 },
  now: () => Date.now(), // override for deterministic tests
  evictAfterMs: 60_000, // idle-eviction window for per-pair buckets
});
```

Per-pair buckets that have been at full capacity for at least
`evictAfterMs` are dropped opportunistically on the next acquire to
bound memory under high-fanout workloads. No background timer is
scheduled; eviction is lazy.

## OpenTelemetry attributes

The decorator emits a `whatsapp.queue.acquire` span around the two
bucket acquisitions:

| Attribute                       | Value                                         |
| ------------------------------- | --------------------------------------------- |
| `whatsapp.queue.pair_recipient` | `hashPhoneNumberId(to)` — PII-redacted digest |
| `whatsapp.queue.waba_id`        | `hashPhoneNumberId(client.wabaId)`            |

The span duration is the queue latency: how long the caller waited
before Meta's HTTP request was issued. Compared to the
`whatsapp.request` span (already emitted by the wrapped client), you
can distinguish queue time from network time per call.

## When to use this primitive

- **Notification pipelines** — Stripe webhook → utility template;
  fan-out from one event to N recipients.
- **Replay-after-incident** — your system was down, you've got a
  backlog to drain. The queue smooths the drain to Meta's tolerable
  rate instead of triggering retries.
- **Marketing template sends** — large-fanout campaigns where the
  source list naturally bursts.
- **Multi-tenant SaaS** — one queue per tenant. Tenants don't
  starve each other.

## When NOT to use this primitive

- **Distributed deployments.** This is in-process. A multi-worker
  setup needs a shared backend (Redis BullMQ, SQS, Postgres job
  queue) so all workers see the same bucket. See
  [`docs/patterns.md`](./patterns.md) § 6 for the by-hand pattern
  if you need cross-process queueing.
- **Persistent queueing.** Messages queued at process restart are
  lost. If you need durability, queue at a higher layer and pull
  from there into the SDK.
- **Drain-aware send.** No public `waitForDrain()`. Callers who
  need it can `await Promise.all(sends)` on their own.

## Mock client compatibility

`withRateLimit` works against `MockWhatsAppClient` for tests and
local development — same shape, same semantics, no network calls.
This makes it trivial to test queue-dependent code without
touching Meta.

```ts
import { MockWhatsAppClient, withRateLimit } from "@dojocoding/whatsapp-sdk";

const mock = new MockWhatsAppClient({ phoneNumberId: "PNID", wabaId: "WABA" });
const queued = withRateLimit(mock, { perWaba: { mps: 1 } });

// Drives the queue against in-memory recorded sends.
await queued.sendText({ to: "+1", body: "x" });
expect(mock.sentMessages).toHaveLength(1);
```

## Lower-level primitives

For non-WhatsApp use cases, the underlying primitives are exported:

```ts
import { TokenBucket, BucketMap } from "@dojocoding/whatsapp-sdk";

const bucket = new TokenBucket({ capacity: 10, refillPerMs: 10 / 1_000 });
await bucket.acquire(1); // resolves immediately if tokens available
```

Both `TokenBucket` and `BucketMap` are independently usable — they
don't reference the WhatsApp domain at all. They're exported for
consumers who want the same primitive applied to a different rate
ceiling (Stripe, OpenAI, etc.).

## Cross-references

- [`docs/client.md`](./client.md) — `WhatsAppClient`, the typical
  thing you wrap.
- [`docs/mock.md`](./mock.md) — `MockWhatsAppClient`, also wrappable.
- [`docs/patterns.md`](./patterns.md) § 6 — the by-hand
  rate-limit-aware queue pattern for cross-process deployments.
- [`docs/compliance.md`](./compliance.md) — Meta's actual ceilings
  and what they mean.
