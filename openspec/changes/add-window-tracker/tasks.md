## 1. WindowTracker

- [x] 1.1 Create `src/window/tracker.ts` exporting `WindowTracker`. Constructor `{ phoneNumberId, storage, ttlMs? }`. `notifyInbound(customerWaId, atMs?)` and `isWindowOpen(customerWaId)`. Storage key shape `window:${phoneNumberId}:${customerWaId}`. Plus `clear(customerWaId)` for invalidation after a hard error.
- [x] 1.2 Wire `src/window/index.ts` to re-export `WindowTracker`.
- [x] 1.3 Add `test/unit/window/tracker.test.ts`: time-mocked tests at the 24h boundary (open at 23h59m59s, closed at 24h+1ms), notifyInbound refresh, cross-phoneNumberId isolation, default ttlMs equals WINDOW_TTL_MS, clear() removes entry. (8 cases)

## 2. Client integration

- [x] 2.1 Add optional `windowTracker?: WindowTracker` to `WhatsAppClientOptions`.
- [x] 2.2 Add an internal `#assertWindowOpen(to)` helper on `WhatsAppClient` that, when a tracker is configured, awaits `tracker.isWindowOpen(to)` and throws `WindowClosedError(to)` if false.
- [x] 2.3 Apply the gate to free-form sends. NOT applied to `sendTemplate`, `sendReaction`. `sendReply` checks if the wrapped payload is non-template/reaction.
- [x] 2.4 Add `client.isWindowOpen(to)` convenience method (returns `true` when no tracker is configured; otherwise delegates).

## 3. Public surface

- [x] 3.1 `src/index.ts` re-exports `WindowTracker` via `export * from "./window/index.js"`.

## 4. Tests

- [x] 4.1 Add `test/contract/window-tracker/client-gated.test.ts` (msw): closed window throws WindowClosedError before HTTP; open window proceeds; templates / reactions are exempt.
- [x] 4.2 Confirm `sendTemplate` and `sendReaction` ignore the tracker.
- [x] 4.3 The `sendReply` gating is covered (free-form payload throws; template payload is exempt). Round-trip "inbound → window open → outbound succeeds → time advance → window closed → outbound throws" is implicitly covered by the unit + contract tests; an end-to-end harness will land in mock-mode (Phase 6).

## 5. Verification

- [x] 5.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [x] 5.2 `pnpm test:coverage` — 223/223 tests; 97.23% lines / 86.17% branches.
- [x] 5.3 `pnpm build` — `WindowTracker`, `WindowTrackerOptions`, the new `windowTracker` constructor field, and `client.isWindowOpen` all in `dist/index.d.ts`.
- [x] 5.4 `openspec validate add-window-tracker --strict` passes.
