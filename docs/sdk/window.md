# 24-hour window (`window-tracker`)

Meta's customer-service-window rule: **outside the 24 hours that follow a
customer's most recent inbound message, only approved templates may be
sent.** Meta rejects free-form sends with error code `131047` ("Re-engagement
message"). Do not confuse this with `131026` ("Message Undeliverable"),
which means the recipient is unreachable on WhatsApp entirely — a template
send will NOT recover from `131026`. The SDK maps `131047` →
`WindowClosedError` and `131026` → `UndeliverableError`.

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
  await tracker.notifyInbound(e.from, e.timestamp);
  // … your normal handling
});
```

### Keying: phone number or BSUID

The client checks the tracker with the identifier the send is addressed
to: `to` for phone-number sends and `recipient` for BSUID sends. The
opt-in registry pre-flight uses the same key. Call `notifyInbound` with
that same identifier. If you reply by BSUID, pass the inbound event's
BSUID (`from_user_id` on the wire, `fromUserId` where the event carries
it); otherwise pass `e.from`. A window opened under the phone number does
not open it under the BSUID, and the reverse is also true. If you
address the same user both ways, notify both keys.

```ts
receiver.on("message", async (e) => {
  const key = e.fromUserId ?? e.from; // match how you send: { recipient } vs { to }
  await tracker.notifyInbound(key, e.timestamp);
});
```

### Free Entry Point (FEP) window

A user who messages you from a Click-to-WhatsApp ad, and gets your
reply within the customer-service window, opens a Free Entry Point
window. Meta says it "may remain open for up to 7 days" (not 72 hours).
FEP is a **pricing** rule: messages in it are not charged. It is not a
send gate. Free-form sends still need the 24h customer-service window,
so the tracker's 24h TTL stays correct for CTWA conversations. Source:
https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing

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

With both wired, `client.sendText`, `client.sendImage`,
`client.sendReaction`, … all throw `WindowClosedError` synchronously when
the window for the recipient is closed, _before_ any HTTP call. **Only
approved templates** (`sendTemplate`, `sendAuthTemplate`,
`sendCarouselTemplate`) are window-exempt — that's a Meta rule, not an
SDK choice. Reactions look like they should be exempt because they're
part of an existing thread, but Meta gates them like any other free-form
send.

## Behaviour

```ts
await tracker.notifyInbound("521234567890");
await tracker.isWindowOpen("521234567890"); // → true

// Time passes …
await tracker.isWindowOpen("521234567890"); // → false at TTL+1ms
```

| Method                               | Effect                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `notifyInbound(customerWaId, atMs?)` | Records the customer's inbound timestamp (`atMs`, default now); see below.  |
| `isWindowOpen(customerWaId)`         | `true` iff the recorded inbound timestamp is less than `ttlMs` in the past. |
| `clear(customerWaId)`                | Force-close a window (e.g. after a hard error). `@internal`.                |

The TTL boundary is exclusive: at exactly `ttlMs` after the inbound
timestamp, the window is closed.

### Pass the customer's timestamp

Meta retries webhook deliveries with backoff for up to 7 days, and
queue-based deployments replay events. Always forward
`MessageEvent.timestamp` (already normalised to epoch ms) so the
window opens from when the customer wrote, not from when the bytes
arrived:

```ts
receiver.on("message", (e) => tracker.notifyInbound(e.from, e.timestamp));
```

`notifyInbound` applies three rules:

- If `atMs` is `ttlMs` or more in the past, it is a **no-op** — that
  window has already closed at Meta and a free-form send would fail
  with `131047`.
- An older timestamp **never shortens** a window opened by a newer one
  (replays are safe).
- The storage TTL is the _remaining_ window (`ttlMs − (now − atMs)`),
  so a message from 20 h ago opens a 4 h window, not a fresh 24 h one.

## Cross-instance isolation

Two trackers backed by the same `Storage` but with different
`phoneNumberId`s do **not** share state. A notify on tracker A for a
given customer does not open the window on tracker B for the same
customer. Multi-WABA tenancy is built in.

## Without a tracker

If you construct a `WhatsAppClient` without `windowTracker`, all sends
are ungated client-side. They'll still fail at Meta with `131047` if the
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
  the recipient unless the client was built with
  `redactProviderMessages: true`.
- **Only approved templates are window-exempt** — that's a Meta rule,
  not an SDK convention. Reactions are NOT exempt despite being attached
  to an existing thread; pre-flighting them via the tracker is correct.
- **Omitting `atMs` means "the customer wrote just now".** That is
  only true when your handler runs on the first delivery. Behind a
  queue or after a Meta retry it silently re-opens a window Meta has
  already closed. Pass `e.timestamp`.
- **One tracker per phone number.** Don't share a tracker across two
  phone numbers — keys would collide silently in your head, even though
  the SDK scopes by `phoneNumberId` internally.

## Spec scenarios worth knowing

From `openspec/specs/window-tracker/spec.md`:

- `notifyInbound` immediately followed by `isWindowOpen` → `true`.
- After `WINDOW_TTL_MS` elapses, `isWindowOpen` → `false`.
- A second `notifyInbound` past the TTL refreshes the window.
- `notifyInbound(wa, now − 30 h)` leaves the window closed; an older
  replay never shortens a window opened by a newer inbound.
- Two trackers on the same `Storage` with different `phoneNumberId` do
  not see each other's notifies.
