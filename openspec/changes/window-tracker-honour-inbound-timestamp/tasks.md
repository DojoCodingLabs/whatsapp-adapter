## 1. Tracker

- [x] 1.1 `src/window/tracker.ts`: store the inbound timestamp; TTL = remaining window; no-op past `ttlMs`; never overwrite a newer timestamp; clamp future `atMs`.
- [x] 1.2 `isWindowOpen` compares stored timestamp vs `now`; legacy `true` reads as open.

## 2. Bridge

- [x] 2.1 `src/agent-bridge/bridge.ts` + `types.ts`: pass `event.timestamp`.

## 3. Tests

- [x] 3.1 `test/unit/window/tracker.test.ts`: late delivery closed; 20 h-old inbound → 4 h window; older replay doesn't shorten; exclusive boundary; clock-skew clamp; legacy `true`.
- [x] 3.2 `test/contract/agent-bridge/dispatch.test.ts`: fixture uses `Date.now()`; new scenario asserts `notifyInbound(from, timestamp)` and a 30 h-old event leaves `windowOpen === false`.

## 4. Docs

- [x] 4.1 `docs/sdk/window.md`: method table, "Pass the customer's timestamp" section, gotcha rewritten.
- [x] 4.2 All `notifyInbound(e.from)` / `notifyInbound(event.from)` snippets under `docs/` and `packages/whatsapp-sdk/README.md` pass the timestamp.
