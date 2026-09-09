# window-tracker Specification

## Purpose
TBD - created by archiving change add-window-tracker. Update Purpose after archive.
## Requirements
### Requirement: WindowTracker class with pluggable Storage
The package SHALL export a `WindowTracker` class. Constructor: `{ phoneNumberId: string; storage: Storage; ttlMs?: number }`. Default `ttlMs = WINDOW_TTL_MS` (24 h). Storage key shape: `window:${phoneNumberId}:${customerWaId}` so multiple `WhatsAppClient` instances (one per phone number / WABA) do not collide on the same `Storage`.

#### Scenario: Default ttlMs equals WINDOW_TTL_MS
- **WHEN** a WindowTracker is constructed without `ttlMs`
- **THEN** the effective TTL equals 86_400_000

#### Scenario: Constructor accepts a custom ttlMs
- **WHEN** a WindowTracker is constructed with `ttlMs: 60_000`
- **THEN** the tracker's effective TTL is 60_000

### Requirement: notifyInbound records the customer's last inbound timestamp
`tracker.notifyInbound(customerWaId, atMs?)` SHALL store the customer's inbound timestamp for `customerWaId` under the tracker's `phoneNumberId`. `atMs` is the customer's message timestamp in epoch milliseconds (callers SHALL pass `MessageEvent.timestamp`) and defaults to `Date.now()`. The stored value SHALL be the inbound timestamp itself, and the storage TTL SHALL be the remaining window `ttlMs - (now - atMs)` so TTL-evicting and non-evicting backends agree on the boundary. The call SHALL:
- be a no-op when `atMs` is `ttlMs` or more in the past (that window has already closed at Meta);
- never overwrite a recorded timestamp that is newer than `atMs` (an older replayed delivery never shortens a live window);
- clamp a future-dated `atMs` to `now` so clock skew cannot manufacture a window longer than `ttlMs`.
Calling notifyInbound twice for the same customer with a newer timestamp SHALL refresh the window.

#### Scenario: notifyInbound starts the 24h window
- **WHEN** `notifyInbound("521234567890")` is called and immediately followed by `isWindowOpen("521234567890")`
- **THEN** `isWindowOpen` resolves to `true`

#### Scenario: notifyInbound refreshes a stale window
- **WHEN** `notifyInbound("X")` is called, time advances past the TTL, and `notifyInbound("X")` is called again
- **THEN** `isWindowOpen("X")` resolves to `true`

#### Scenario: A late delivery older than ttlMs leaves the window closed
- **WHEN** `notifyInbound("X", now - 30h)` is called on a fresh tracker
- **THEN** `isWindowOpen("X")` resolves to `false`

#### Scenario: The window opens from the inbound timestamp, not receipt time
- **WHEN** `notifyInbound("X", now - 20h)` is called
- **THEN** `isWindowOpen("X")` resolves to `true`
- **AND** after a further `4h - 1ms` it still resolves to `true`
- **AND** after `4h + 1ms` it resolves to `false`

#### Scenario: An older replay never shortens a window opened by a newer inbound
- **WHEN** `notifyInbound("X", now - 1h)` is called and then `notifyInbound("X", now - 23h)` is called
- **AND** time advances by 2h
- **THEN** `isWindowOpen("X")` resolves to `true`

#### Scenario: Future-dated timestamps are clamped to now
- **WHEN** `notifyInbound("X", now + 10h)` is called and time advances by `WINDOW_TTL_MS + 1`
- **THEN** `isWindowOpen("X")` resolves to `false`

### Requirement: isWindowOpen reflects TTL boundary
`tracker.isWindowOpen(customerWaId)` SHALL return `true` when the recorded inbound timestamp is strictly less than `ttlMs` in the past, and `false` otherwise. The boundary is exclusive: at exactly `ttlMs` after the inbound timestamp, the window is closed. A live legacy entry whose stored value is `true` (the pre-0.10 value shape) SHALL be treated as open so a rolling upgrade does not close every window at once.

#### Scenario: Window is closed before any notifyInbound
- **WHEN** `isWindowOpen("never-seen")` is called on a fresh tracker
- **THEN** the return value is `false`

#### Scenario: Window is open at 23h59m59s after notify
- **WHEN** `notifyInbound("X")` is called, time advances by `WINDOW_TTL_MS - 1_000` ms, and `isWindowOpen("X")` is called
- **THEN** the return value is `true`

#### Scenario: Window is closed at TTL+1 ms
- **WHEN** `notifyInbound("X")` is called, time advances by `WINDOW_TTL_MS + 1` ms, and `isWindowOpen("X")` is called
- **THEN** the return value is `false`

#### Scenario: Legacy `true` entry reads as open
- **WHEN** the backing `Storage` holds a live `true` under `window:P:X` and `isWindowOpen("X")` is called
- **THEN** the return value is `true`

### Requirement: phoneNumberId scopes tracker keys
Two `WindowTracker` instances backed by the same `Storage` but different `phoneNumberId`s SHALL NOT share state. A notify on tracker A for a given `customerWaId` SHALL leave tracker B's `isWindowOpen` for the same `customerWaId` returning `false`.

#### Scenario: Cross-phone-number isolation
- **WHEN** trackerA(phoneNumberId="A") calls `notifyInbound("X")` and trackerB(phoneNumberId="B") calls `isWindowOpen("X")`
- **THEN** trackerB's call returns `false`
- **AND** trackerA's `isWindowOpen("X")` returns `true`

### Requirement: WindowTracker works against any Storage backend

The `WindowTracker` capability is documented as taking a `Storage` instance, but until now `InMemoryStorage` was the only implementation. With `createRedisStorage` and `createPostgresStorage` now shipping alongside, the `WindowTracker` SHALL produce byte-identical observable behaviour regardless of which `Storage` implementation backs it.

In multi-process deployments, single-process backends (`InMemoryStorage`) produce different `isWindowOpen` answers across processes, silently violating the 24-hour-window contract. Documentation SHALL recommend a shared backend (Redis or Postgres) for any deployment with more than one Node process.

#### Scenario: WindowTracker behaviour parity across backends

- **WHEN** the same sequence of `notifyInbound` and `isWindowOpen` calls is issued against a `WindowTracker` configured with `InMemoryStorage`, `createRedisStorage(client)`, or `createPostgresStorage(client)`
- **THEN** the boolean returned by `isWindowOpen` is identical across all three configurations for every input
- **AND** TTL expiry follows the same wall-clock boundary

#### Scenario: Multi-process documentation recommendation

- **WHEN** the consumer reads `docs/storage.md` or `docs/window.md`
- **THEN** the docs explicitly state that `InMemoryStorage` is NOT safe for multi-process deployments
- **AND** the docs link to `createRedisStorage` and `createPostgresStorage` as the supported shared-backend options

