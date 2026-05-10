## ADDED Requirements

### Requirement: WindowTracker class with pluggable Storage
The package SHALL export a `WindowTracker` class. Constructor: `{ phoneNumberId: string; storage: Storage; ttlMs?: number }`. Default `ttlMs = WINDOW_TTL_MS` (24 h). Storage key shape: `window:${phoneNumberId}:${customerWaId}` so multiple `WhatsAppClient` instances (one per phone number / WABA) do not collide on the same `Storage`.

#### Scenario: Default ttlMs equals WINDOW_TTL_MS
- **WHEN** a WindowTracker is constructed without `ttlMs`
- **THEN** the effective TTL equals 86_400_000

#### Scenario: Constructor accepts a custom ttlMs
- **WHEN** a WindowTracker is constructed with `ttlMs: 60_000`
- **THEN** the tracker's effective TTL is 60_000

### Requirement: notifyInbound records the customer's last inbound timestamp
`tracker.notifyInbound(customerWaId, atMs?)` SHALL store the most recent inbound timestamp for `customerWaId` under the tracker's `phoneNumberId`. `atMs` defaults to `Date.now()`. Calling notifyInbound twice for the same customer SHALL refresh the TTL.

#### Scenario: notifyInbound starts the 24h window
- **WHEN** `notifyInbound("521234567890")` is called and immediately followed by `isWindowOpen("521234567890")`
- **THEN** `isWindowOpen` resolves to `true`

#### Scenario: notifyInbound refreshes a stale window
- **WHEN** `notifyInbound("X")` is called, time advances past the TTL, and `notifyInbound("X")` is called again
- **THEN** `isWindowOpen("X")` resolves to `true`

### Requirement: isWindowOpen reflects TTL boundary
`tracker.isWindowOpen(customerWaId)` SHALL return `true` when a notifyInbound landed within the last `ttlMs`, and `false` otherwise. The boundary is exclusive: at exactly `ttlMs` after the notify, the window is closed.

#### Scenario: Window is closed before any notifyInbound
- **WHEN** `isWindowOpen("never-seen")` is called on a fresh tracker
- **THEN** the return value is `false`

#### Scenario: Window is open at 23h59m59s after notify
- **WHEN** `notifyInbound("X")` is called, time advances by `WINDOW_TTL_MS - 1_000` ms, and `isWindowOpen("X")` is called
- **THEN** the return value is `true`

#### Scenario: Window is closed at TTL+1 ms
- **WHEN** `notifyInbound("X")` is called, time advances by `WINDOW_TTL_MS + 1` ms, and `isWindowOpen("X")` is called
- **THEN** the return value is `false`

### Requirement: phoneNumberId scopes tracker keys
Two `WindowTracker` instances backed by the same `Storage` but different `phoneNumberId`s SHALL NOT share state. A notify on tracker A for a given `customerWaId` SHALL leave tracker B's `isWindowOpen` for the same `customerWaId` returning `false`.

#### Scenario: Cross-phone-number isolation
- **WHEN** trackerA(phoneNumberId="A") calls `notifyInbound("X")` and trackerB(phoneNumberId="B") calls `isWindowOpen("X")`
- **THEN** trackerB's call returns `false`
- **AND** trackerA's `isWindowOpen("X")` returns `true`
