## Context

The 24-hour customer-service window is the highest-leverage piece of business logic the SDK can encapsulate. Without it, every consumer either hand-rolls the same TTL-tracking + free-form-vs-template branching, OR they don't, and they discover via Meta's `131026` errors that they wasted half their template send quota. Phase 4 introduces `WindowTracker` so the rule lives in one place.

Domain rules from `openspec/config.yaml` `context` that this design must satisfy:
- 24h window opens on inbound message; outside it only templates may be sent.
- Multi-tenant by construction — one `WhatsAppClient` per WABA / phone-number; trackers must scope by phoneNumberId.
- Pluggable `Storage` (already introduced in Phase 3) so consumers can BYO Redis.
- Errors are typed: window-closed pre-flight throws `WindowClosedError` (already exists in the error hierarchy).

## Goals / Non-Goals

**Goals:**
- A `WindowTracker` whose API is two methods: `notifyInbound`, `isWindowOpen`.
- Optional wiring into `WhatsAppClient` so free-form sends throw before hitting Meta.
- Storage-backed so multi-process consumers can share state via Redis.
- Time-mocked tests around the 24-h boundary.

**Non-Goals:**
- Auto-fallback to template messages when the window is closed (consumer's call).
- Wiring into the receiver — consumers explicitly call `tracker.notifyInbound(event.from)` from their `.on('message', …)` handler. The SDK does NOT auto-wire because consumers may have multiple trackers (one per phone number) and the SDK has no way to know which one to update.
- Tracking "system" messages or admin events.
- Persisting the inbound *content* — only the timestamp.

## Decisions

### Decision: tracker is constructor-time, not a constructor-time option that mutates send methods later
**Rationale.** Pre-flight check is cheap (`O(1)` storage lookup). Wiring it into the convenience methods at construction time means consumers cannot accidentally bypass it by importing the standalone builders. Tests can opt out by not passing `windowTracker`.
**Alternatives considered.** Decorator/middleware pattern (more flexibility, more API surface). Per-call opt-in (requires every call site to remember; defeats the point).

### Decision: `sendTemplate` and `sendReaction` skip the check; everything else is gated
**Rationale.** Templates are exactly the escape hatch when the window is closed — consulting the tracker for template sends would be wrong (they're allowed regardless). Reactions are part of an existing thread; Meta does not gate them by window in practice (the originating message's wamid acts as the context).
**Alternatives considered.** Gate everything (breaks Meta's documented template-fallback flow). Gate nothing (defeats the purpose).

### Decision: consumers are responsible for calling `tracker.notifyInbound` from their inbound handler
**Rationale.** The SDK does not auto-wire because:
1. Consumers running multiple `WhatsAppClient`s (one per phone number) need separate trackers; the SDK has no automatic "which tracker?" mapping.
2. Consumers may want to debounce, batch, or filter which inbound messages reset the window (e.g., ignore `system` events).
3. Auto-wiring couples the receiver and tracker and forces consumers to opt out, which is more complex than opt-in.

The README example will show the explicit `receiver.on("message", e => tracker.notifyInbound(e.from))` line.

**Alternatives considered.** WebhookReceiver gains a `windowTracker` option (fewer LOC for consumers, but couples two capabilities and forces multi-tenant routing).

### Decision: storage key is `window:${phoneNumberId}:${customerWaId}`
**Rationale.** Cross-phone-number isolation matters: the same customer may have messaged business A and not business B. Including `phoneNumberId` in the key enforces it. The `window:` prefix lets consumers grep / namespace the same Storage with other key kinds (Phase 3's deduper uses `msg:` / `status:`).
**Alternatives considered.** Per-tracker Storage instance (over-flexible; consumers usually want one shared Redis). Untraversed prefix (collisions if two consumers share Storage carelessly).

### Decision: window TTL is exclusive at the boundary (closed at exactly 24h00m00.001s)
**Rationale.** Meta's 24h window is documented as `[opens_at, opens_at + 24h)`. Matching that exact boundary is correct. Tests are `vi.advanceTimersByTime(WINDOW_TTL_MS - 1)` → open, `+ 1` → closed.
**Alternatives considered.** Round to the nearest minute (drifts from Meta's rule). Inclusive (off by one).

```
                    inbound webhook
                          │
                          ▼
              ┌─────────────────────────┐
              │ tracker.notifyInbound() │  storage.set(window:..., true, ttl)
              └─────────────────────────┘

                    outbound send (free-form)
                          │
                          ▼
              ┌─────────────────────────┐
              │ tracker.isWindowOpen()? │  storage.get(window:...)
              └────────────┬────────────┘
                           │
                  ┌────────┴────────┐
                 yes               no
                  │                 │
                  ▼                 ▼
            send via             throw
            Phase 1              WindowClosedError
            transport            (no HTTP)
```

## Risks / Trade-offs

- **Risk:** Consumer forgets to call `notifyInbound` → free-form sends always throw. **Mitigation:** README example on the canonical wiring; the `WindowClosedError` message is explicit.
- **Risk:** Storage write races on `notifyInbound` (two concurrent inbounds for the same customer). **Mitigation:** `set` (not `setIfAbsent`); last-write-wins is the correct semantic.
- **Risk:** Clock skew between the SDK process and the storage backend. **Mitigation:** lazy TTL eviction in `InMemoryStorage` uses the same clock that wrote the entry; for Redis impls, consumers can use Redis-side TTL.
- **Trade-off:** No retroactive backfill — if a consumer adopts the tracker mid-conversation and the customer messaged 5 minutes ago, the tracker doesn't know. They'll see a `WindowClosedError` on the next free-form send until the next inbound. Consumer can manually `notifyInbound` once at boot to bootstrap from their own message log.

## Migration Plan

Additive — `windowTracker` is optional. Existing callers keep working without changes.

## Open Questions

- Should `client.isWindowOpen(to)` be exposed as a public method (re-exposing the tracker via the client)? **Tentative:** yes — adds one line, removes a level of indirection for callers who only have the client.
