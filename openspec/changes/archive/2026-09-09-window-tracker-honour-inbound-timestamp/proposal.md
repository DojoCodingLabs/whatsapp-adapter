# Change proposal — `WindowTracker.notifyInbound` honours the inbound timestamp

Affected capabilities: `window-tracker`, `agent-bridge`.

## Why

`notifyInbound(customerWaId, _atMs?)` accepted a timestamp and
ignored it, always writing a fresh 24 h TTL from receipt time
(audit finding F4, probe P6). Meta retries webhook deliveries with
backoff for up to 7 days and queue-based deployments replay events,
so a late delivery re-opened a window Meta had already closed. The
next free-form send then failed at Meta with `131047` — exactly the
round-trip the client-side gate exists to prevent.

`MessageEvent.timestamp` is already normalised to epoch ms by the
parser; nothing forwarded it. The `agent-bridge` (F21) and every
cookbook called `notifyInbound(event.from)` without it.

## What Changes

- `notifyInbound` stores the inbound timestamp (not `true`) and
  sets the storage TTL to the _remaining_ window
  `ttlMs − (now − atMs)`.
- No-op when `atMs` is `ttlMs` or more in the past; an older
  timestamp never shortens a window opened by a newer one;
  future-dated timestamps are clamped to `now`.
- `isWindowOpen` compares the stored timestamp against `now`
  (belt-and-braces with the storage TTL) and treats a live legacy
  `true` entry as open for rolling upgrades.
- `createAgentBridge` forwards `event.timestamp`.
- Every doc and cookbook snippet passes `e.timestamp` /
  `event.timestamp`.

## Non-goals

- Reading Meta's server-side window state (there is no API for it).
- Changing the `Storage` interface.

## Impact

- `window-tracker` spec: 2× MODIFIED requirements.
- `agent-bridge` spec: 1× MODIFIED requirement.
- Stored value shape changes `true` → `number`; readers of the raw
  key (none in-repo) must accept both. Minor.
