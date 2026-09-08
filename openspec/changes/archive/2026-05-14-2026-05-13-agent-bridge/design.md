# Design — `agent-bridge`

## Approach

A single factory function `createAgentBridge(input)` that registers
one `receiver.on("message", handler)` and returns a `{ dispose }`
control. The handler:

1. Calls `windowTracker.notifyInbound(event.from)` when configured.
2. Returns early if `isOnTakeover(event)` resolves truthy.
3. Fires `client.markAsRead({ messageId, typing })` fire-and-forget
   when `autoMarkRead` is on. Errors are swallowed; the typing
   indicator is best-effort and must NEVER block enqueue.
4. Runs `transform(event)` (or the bundled default) to produce an
   `AgentTask | null`. `null` means "skip" — e.g., for system or
   unsupported events the consumer doesn't care about.
5. `await inbox.append(task)`. Errors here propagate to `onError`
   (when supplied) and do NOT re-throw inside the receiver's
   handler set — Meta's 30 s ack rule wins. The `error` event on
   the receiver still fires through the standard handler chain.

`dispose()` calls `receiver.off("message", handler)`. Safe to call
twice. Bridges that share a receiver compose — register multiple,
dispose independently.

## Domain rules satisfied

- **Meta 30s ack rule.** The receiver returns 200 before our
  handler runs; bridge work is inside that async dispatch. Inbox
  errors are caught; `markAsRead` is fire-and-forget. We never
  hold the ack.
- **Zero global state.** The bridge is per-instance. Multi-WABA
  deployments construct N bridges, one per receiver.
- **24h window tracker is the source of truth for window state.**
  We call `notifyInbound` before extracting `windowOpen` into the
  task, so the task accurately reflects post-notify state.
- **PII redaction.** The bridge logs nothing by default. Tasks
  carry the raw recipient (`from`) because the agent needs it —
  consumers redact at their logging boundary, same as for any
  inbound handler today.
- **Spec-driven; one capability per folder.** New
  `openspec/specs/agent-bridge/spec.md` lands on archive.

## Decisions

### 1. Why a factory, not a class

`createAgentBridge` returns the disposer. No state besides the
registered handler reference. A class would surface no additional
operations (no `pause` / `resume`, no inbox swap mid-flight —
those are out of scope per Non-Goals; consumers re-create the
bridge if they need re-config). A factory is the smaller surface.

### 2. Why `AgentInbox.append` is the entire interface

One method. `Storage`-style. Consumers wanting fan-out, retries,
or transactional enqueue wrap their backend behind a
single-method shim. This matches the posture of `Storage`,
`OptInRegistry`, and `WindowTracker.Storage` — small interfaces,
plug-replaceable.

No `flush` / `close` on the interface: the bridge doesn't own the
inbox lifecycle; consumers do. The bridge's `dispose()` only
detaches from the receiver.

### 3. Why auto-`notifyInbound` is opt-out, not opt-in

The most-forgotten line in every hybrid cookbook is exactly
`tracker.notifyInbound(event.from)`. Forgetting it means every
subsequent free-form send throws `WindowClosedError` mid-loop —
a top-3 bug-report shape. Auto-on protects the common case;
consumers managing their tracker manually pass
`windowTracker: undefined` (and the bridge skips the call).

### 4. Why auto-`markAsRead` + typing is opt-out, not opt-in

Same reasoning. The pattern is documented in the
`cookbook/hybrid/typing-while-thinking.md` recipe; baking it into
the bridge defaults eliminates the "I forgot the ack" failure
mode. Consumers wanting to ack only after agent acceptance set
`autoMarkRead: false` and call `client.markAsRead` themselves.

The fire-and-forget is intentional — `await`ing the ack adds an
HTTP round-trip to the dispatch path, and the ack failing is
NOT a reason to drop the message. The promise is registered with
`.catch(() => {})` so unhandled-rejection warnings don't fire.

### 5. Why one bundled transform, no extension points beyond the
single `transform` callback

The default transform extracts the fields the front-desk pattern
needs (text, media ids, button/list reply, location, reply-to,
referral, window-open). Consumers wanting different shapes
supply a `transform` callback. We don't ship a transform-stack
or middleware-chain because:

- One callback per bridge is sufficient.
- A middleware framework is what consumers' agent runtime
  already gives them — duplicating it at the bridge layer is
  scope creep.

The bundled default is also exported so consumers building their
own transform can compose it: `transform: (e) => ({ ...defaultTransform(e), tenantId: lookup(e) })`.

### 6. Why `null` is a valid `transform` return

Some inbound events are noise to a given agent — unsupported
types, system messages, button presses for past flows. Returning
`null` skips enqueue without forcing the consumer to filter
beforehand or wrap with a try/catch. Symmetric with `Storage`
returning `undefined` for unknown keys.

### 7. Why status webhooks are out of scope

`StatusEvent` carries different metadata, different routing
semantics (typically not into the agent loop), and different
failure modes (Meta retries vs at-most-once). Mixing them into
the same inbox interleaves concerns. Consumers needing status
processing register their own `receiver.on("status", h)` —
unchanged from today.

### 8. Sub-module placement

Lives at `src/agent-bridge/`. Re-exported from the root barrel
(`src/index.ts`) — no peer dependencies, small bundle impact,
so a separate sub-module export (`/agent-bridge`) is unnecessary
overhead. If a future Redis/SQS adapter ships pre-built, it goes
to its own sub-module (`/agent-bridge/redis`, mirroring
`/storage/redis`).

### 9. Mock-mode parity

The bridge takes a `WhatsAppLikeClient`, so `MockWhatsAppClient`
works verbatim. The mock's `markAsRead` records to `markReads`,
which the parity tests can assert. No mock-specific code needed.

### 10. Non-goals re-stated

We don't ship:
- A Redis Streams / Postgres LISTEN adapter (cookbook only)
- A status-event router
- Conversation-state persistence
- An agent runner

Each of those is a separate decision the consumer makes against
a stable surface that this bridge does not foreclose.
