## MODIFIED Requirements

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
