## 1. WindowTracker

- [ ] 1.1 Create `src/window/tracker.ts` exporting `WindowTracker`. Constructor `{ phoneNumberId, storage, ttlMs? }`. `notifyInbound(customerWaId, atMs?)` and `isWindowOpen(customerWaId)`. Storage key shape `window:${phoneNumberId}:${customerWaId}`.
- [ ] 1.2 Wire `src/window/index.ts` to re-export `WindowTracker`.
- [ ] 1.3 Add `test/unit/window/tracker.test.ts`: time-mocked tests at the 24h boundary (open at 23h59m59s, closed at 24h+1ms), notifyInbound refresh, cross-phoneNumberId isolation, default ttlMs equals WINDOW_TTL_MS.

## 2. Client integration

- [ ] 2.1 Add optional `windowTracker?: WindowTracker` to `WhatsAppClientOptions`.
- [ ] 2.2 Add an internal `_assertWindowOpen(to)` helper on `WhatsAppClient` that, when a tracker is configured, awaits `tracker.isWindowOpen(to)` and throws `WindowClosedError(to)` if false.
- [ ] 2.3 Apply the gate to the free-form sends: `sendText`, `sendImage`, `sendVideo`, `sendAudio`, `sendDocument`, `sendSticker`, `sendLocation`, `sendContacts`, `sendInteractive`. NOT applied to `sendTemplate`, `sendReaction`. `sendReply` checks if the wrapped payload is non-template/reaction.
- [ ] 2.4 Add an `isWindowOpen(to)` convenience method on `WhatsAppClient` that returns `true` when no tracker is configured (preserves "not gated" semantics) or delegates to the tracker.

## 3. Public surface

- [ ] 3.1 `src/index.ts` re-exports `WindowTracker`.

## 4. Tests

- [ ] 4.1 Add `test/contract/window-tracker/client-gated.test.ts` (msw): with a tracker that returns `isWindowOpen=false`, `sendText` rejects with `WindowClosedError` and NO HTTP request fires; with `isWindowOpen=true`, the request fires.
- [ ] 4.2 Confirm `sendTemplate` and `sendReaction` ignore the tracker.
- [ ] 4.3 Add an integration-style test that wires a `WebhookReceiver` to a `WindowTracker` via `.on("message", e => tracker.notifyInbound(e.from))` and asserts the round-trip: inbound → window open → outbound succeeds; advance time past TTL → window closed → outbound throws.

## 5. Verification

- [ ] 5.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [ ] 5.2 `pnpm test:coverage` — gates honoured (line ≥90, branch ≥85).
- [ ] 5.3 `pnpm build` — `WindowTracker` and the new client option in `dist/index.d.ts`.
- [ ] 5.4 `openspec validate add-window-tracker --strict` passes.
