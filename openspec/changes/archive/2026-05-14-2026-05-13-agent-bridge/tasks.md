## 1. Phase 1 — capability scaffold

- [ ] 1.1 Create `packages/whatsapp-sdk/src/agent-bridge/types.ts` with `AgentInbox`, `AgentTask`, `AgentBridgeOptions`, `CreateAgentBridgeInput`, `AgentBridge` (the disposer return type) interfaces. No runtime code in this file.
- [ ] 1.2 Create `packages/whatsapp-sdk/src/agent-bridge/in-memory.ts` with `InMemoryAgentInbox` — an `AgentInbox` backed by an in-process array. Exposes `tasks: ReadonlyArray<AgentTask>` and `reset()` for tests.
- [ ] 1.3 Create `packages/whatsapp-sdk/src/agent-bridge/transform.ts` with `defaultAgentTransform(event: MessageEvent): AgentTask` — extracts text / media ids / button-or-list reply / location / replyTo / referral / windowOpen from the typed event. Exported so consumers building their own transform can compose it.

## 2. Phase 2 — `createAgentBridge` factory

- [ ] 2.1 Create `packages/whatsapp-sdk/src/agent-bridge/bridge.ts` with `createAgentBridge(input): AgentBridge`. The factory:
  - Defaults `autoMarkRead = true`, `autoTyping = true`.
  - Builds the dispatch handler.
  - Calls `receiver.on("message", handler)`.
  - Returns `{ dispose }` where `dispose` calls `receiver.off("message", handler)` and is idempotent.
- [ ] 2.2 Implement the dispatch handler in order:
  1. `windowTracker?.notifyInbound(event.from)` when configured.
  2. If `isOnTakeover?.(event)` resolves truthy, return early (no ack, no enqueue — consumer's HITL ack is the canonical path).
  3. Fire-and-forget `client.markAsRead({ messageId: event.id, typing: autoTyping })` (only when `autoMarkRead`); attach `.catch(() => {})` so the unhandled-rejection guard never fires.
  4. Build the task via `transform(event) ?? defaultAgentTransform(event)`. If the transform returns `null`, skip enqueue.
  5. `await inbox.append(task)`. On error, call `options.onError?.(err, event)` and swallow — never re-throw into the receiver dispatch.

## 3. Phase 3 — barrel + exports

- [ ] 3.1 Create `packages/whatsapp-sdk/src/agent-bridge/index.ts` barrel exporting types + `InMemoryAgentInbox` + `defaultAgentTransform` + `createAgentBridge`.
- [ ] 3.2 Re-export from `packages/whatsapp-sdk/src/index.ts` via `export * from "./agent-bridge/index.js"`.
- [ ] 3.3 Add the new public symbols to `packages/whatsapp-sdk/test/contract/public-surface.test.ts` drift detector.

## 4. Phase 4 — unit tests

- [ ] 4.1 Add `test/unit/agent-bridge/in-memory.test.ts`: empty by default; `append` records; `reset` clears.
- [ ] 4.2 Add `test/unit/agent-bridge/transform.test.ts`: text message extracts `text`; image extracts media id; button-reply extracts `buttonReplyId`; list-reply extracts `listReplyId`; location extracts coordinates; replyTo on `context.id` extracts `replyToWamid`; CTWA referral propagates; unsupported types still produce a task with `type === "unsupported"` (since the consumer may want to log them).

## 5. Phase 5 — contract tests

- [ ] 5.1 Add `test/contract/agent-bridge/dispatch.test.ts`:
  - End-to-end: `MockWhatsAppClient` + `InMemoryAgentInbox` + `createAgentBridge` + `receiver._dispatchEvents([...])` → inbox receives the canonical `AgentTask`.
  - Auto-`notifyInbound` fires when `windowTracker` is supplied (assert via `tracker.isWindowOpen` after dispatch).
  - Auto-`markAsRead` fires (assert via `mock.markReads`).
  - `autoMarkRead: false` skips the ack.
  - `isOnTakeover` returning true skips enqueue (assert `inbox.tasks.length === 0`).
  - `transform` returning `null` skips enqueue.
  - Inbox `append` rejection triggers `onError` and does NOT crash the receiver dispatch (assert subsequent events still flow).
- [ ] 5.2 Add `test/contract/agent-bridge/dispose.test.ts`:
  - After `dispose()`, subsequent events do NOT reach the inbox.
  - `dispose()` is idempotent (calling twice is a no-op).

## 6. Phase 6 — cookbook & docs

- [ ] 6.1 Add `docs/sdk/agent-bridge.md` — full reference (interfaces, options, scenarios, when to opt out of auto-features). Cross-links to `docs/cookbook/hybrid/agent-handoff-loop.md`.
- [ ] 6.2 Add `docs/cookbook/hybrid/typing-while-thinking.md` — the canonical agentic UX pattern. Documents the fire-and-forget ack, the keep-alive loop for >25 s thinks, the HITL takeover carve-out, the voice-note carve-out (typing on voice is awkward).
- [ ] 6.3 Update `docs/cookbook/hybrid/agent-handoff-loop.md` — replace the hand-rolled `receiver.on("message", …)` boilerplate with the `createAgentBridge` call. Keep the original block in a "without the primitive" sidebar so consumers see the savings.
- [ ] 6.4 Update `docs/architecture.md` — extend the inbound-flow ASCII diagram to show the bridge handing off to the agent inbox.
- [ ] 6.5 Update `docs/cookbook/hybrid/README.md` to list the new recipe.

## 7. Phase 7 — ship + archive

- [ ] 7.1 `openspec validate --changes --strict` passes.
- [ ] 7.2 `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, `pnpm -r build`, `pnpm -r size` all green.
- [ ] 7.3 ROADMAP entry: bridge ships in `sdk-v1.1.0`. Move from 💡 to 🚧.
- [ ] 7.4 Archive: `openspec archive 2026-05-13-agent-bridge`.
