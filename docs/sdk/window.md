# 24-hour window (`window-tracker`)

Meta's customer-service-window rule: **outside the 24 hours that follow a
customer's most recent inbound message, only approved templates may be
sent.** Meta will reject free-form sends with error code `131026`.

`WindowTracker` enforces this rule client-side so `client.sendText(...)`
fails fast (with `WindowClosedError`) instead of after a wasted HTTP
round-trip.

Spec: [`openspec/specs/window-tracker/spec.md`](../openspec/specs/window-tracker/spec.md).
Source: [`packages/whatsapp-sdk/src/window/tracker.ts`](../src/window/tracker.ts).

## Public exports

```ts
import {
  WindowTracker,
  type WindowTrackerOptions,
  WINDOW_TTL_MS, // 24 * 60 * 60 * 1000
  // Storage interface for plugging in Redis etc.
  InMemoryStorage,
  type Storage,
} from "@dojocoding/whatsapp-sdk";
```

## Construction

```ts
const tracker = new WindowTracker({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  storage: new InMemoryStorage(),
  // ttlMs:      WINDOW_TTL_MS, // optional; default is 24h
});
```

The tracker scopes its keys to `phoneNumberId` (key shape:
`window:<phoneNumberId>:<customerWaId>`) so multiple `WhatsAppClient`
instances can share the same `Storage` without colliding.

## Wiring it up

The tracker is **not** auto-wired. You must do two things:

### 1. Tell the tracker when a customer messages you

Inside your `message` webhook handler:

```ts
receiver.on("message", async (e) => {
  await tracker.notifyInbound(e.from);
  // … your normal handling
});
```

### 2. Pass the tracker to the client

```ts
const client = new WhatsAppClient({
  phoneNumberId,
  wabaId,
  token,
  appSecret,
  windowTracker: tracker, // ← pre-flight gate enabled
});
```

With both wired, `client.sendText`, `client.sendImage`, … will throw
`WindowClosedError` synchronously when the window for the recipient is
closed, _before_ any HTTP call. `client.sendTemplate` and
`client.sendReaction` are window-exempt by design — templates are the
escape hatch, reactions are part of an existing thread.

## Behaviour

```ts
await tracker.notifyInbound("521234567890");
await tracker.isWindowOpen("521234567890"); // → true

// Time passes …
await tracker.isWindowOpen("521234567890"); // → false at TTL+1ms
```

| Method                        | Effect                                                        |
| ----------------------------- | ------------------------------------------------------------- |
| `notifyInbound(customerWaId)` | Records (or refreshes) the customer's last inbound timestamp. |
| `isWindowOpen(customerWaId)`  | `true` iff `notifyInbound` landed within the last `ttlMs`.    |
| `clear(customerWaId)`         | Force-close a window (e.g. after a hard error). `@internal`.  |

The TTL boundary is exclusive: at exactly `ttlMs` after a notify, the
window is closed. For consumer-friendly behaviour (close at the boundary
rather than 1ms past), prefer the default 24h.

## Cross-instance isolation

Two trackers backed by the same `Storage` but with different
`phoneNumberId`s do **not** share state. A notify on tracker A for a
given customer does not open the window on tracker B for the same
customer. Multi-WABA tenancy is built in.

## Without a tracker

If you construct a `WhatsAppClient` without `windowTracker`, all sends
are ungated client-side. They'll still fail at Meta with `131026` if the
window is closed — the SDK maps that to `WindowClosedError` via
`mapMetaError`, so the end behaviour is the same. The difference is one
round-trip to `graph.facebook.com` per closed-window send.

For prototyping and tests, "no tracker" is fine. For production, prefer
the explicit pre-flight.

## Storage backends

The default `InMemoryStorage` is fine for single-process deployments.
Multi-instance deployments need a shared store so a notify on one
instance opens the window on the others:

```ts
class RedisStorage implements Storage {
  constructor(private redis: Redis) {}
  async get<T>(key: string): Promise<T | undefined> {
    const v = await this.redis.get(key);
    return v === null ? undefined : (JSON.parse(v) as T);
  }
  async set<T>(key: string, value: T, ttlMs: number) {
    await this.redis.set(key, JSON.stringify(value), "PX", ttlMs);
  }
  async setIfAbsent<T>(key: string, value: T, ttlMs: number) {
    const ok = await this.redis.set(key, JSON.stringify(value), "PX", ttlMs, "NX");
    return ok === "OK";
  }
  async delete(key: string) {
    await this.redis.del(key);
  }
}

const tracker = new WindowTracker({
  phoneNumberId,
  storage: new RedisStorage(redis),
});
```

The `Storage` contract is small (`get`, `set`, `setIfAbsent`, `delete`)
and tested via `test/unit/storage/`.

## Gotchas

- **The tracker is empty until you call `notifyInbound`.** A consumer
  that wires the client but forgets the receiver hook will see every
  free-form send fail with `WindowClosedError`. The error message names
  the recipient.
- **Templates and reactions are window-exempt** — that's a Meta rule,
  not an SDK convention. Don't try to pre-flight them.
- **`notifyInbound(customerWaId, atMs?)` accepts `atMs` for API symmetry
  with future Storage backends that honour caller-supplied timestamps.**
  The default `Storage` impl uses `now()` for the TTL clock, so the value
  is informational against the in-memory backend.
- **One tracker per phone number.** Don't share a tracker across two
  phone numbers — keys would collide silently in your head, even though
  the SDK scopes by `phoneNumberId` internally.

## Spec scenarios worth knowing

From `openspec/specs/window-tracker/spec.md`:

- `notifyInbound` immediately followed by `isWindowOpen` → `true`.
- After `WINDOW_TTL_MS` elapses, `isWindowOpen` → `false`.
- A second `notifyInbound` past the TTL refreshes the window.
- Two trackers on the same `Storage` with different `phoneNumberId` do
  not see each other's notifies.
