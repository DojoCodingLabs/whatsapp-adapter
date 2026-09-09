## MODIFIED Requirements

### Requirement: createAgentBridge dispatch contract

The SDK SHALL export `createAgentBridge(input): AgentBridge`
that registers a `receiver.on("message", handler)` and returns
`{ dispose(): void }`. The handler SHALL execute the following
steps in order for every dispatched inbound `MessageEvent`:

1. **Window tracker auto-notify.** If `input.windowTracker` is
   defined, the handler SHALL call
   `windowTracker.notifyInbound(event.from, event.timestamp)`
   before proceeding, forwarding the customer's message timestamp
   so a late or replayed delivery does not re-open a window Meta
   has already closed. This step SHALL be `await`ed so subsequent
   state reads see the post-notify state.

2. **HITL takeover gate.** If `input.isOnTakeover` is supplied,
   the handler SHALL `await isOnTakeover(event)`. On a truthy
   return, the handler SHALL skip steps 3, 4, and 5 and return.

3. **Auto read-receipt + typing indicator.** If
   `input.autoMarkRead` is truthy (default `true`), the handler
   SHALL fire `client.markAsRead({ messageId: event.id, typing: input.autoTyping ?? true })` AS FIRE-AND-FORGET. The
   returned promise SHALL be wrapped in `.catch(() => {})` so
   unhandled-rejection warnings do not fire. The handler SHALL
   NOT `await` this call.

4. **Transform.** The handler SHALL build the task via
   `(input.transform ?? defaultAgentTransform)(event)`. If the
   transform returns `null`, the handler SHALL skip step 5 and
   return.

5. **Enqueue.** The handler SHALL `await inbox.append(task)`.
   On rejection, the handler SHALL call `input.onError?.(err, event)` if supplied and SHALL swallow the error. Re-throwing
   from inside the receiver dispatch would risk corrupting
   Meta's 30 s ack contract.

`dispose()` SHALL call `receiver.off("message", handler)` and
SHALL be idempotent (calling twice has the same effect as
calling once).

#### Scenario: Inbound message produces a task on the inbox

- **GIVEN** a bridge built from `MockWhatsAppClient`, a `WebhookReceiver`, and an `InMemoryAgentInbox`
- **WHEN** the receiver dispatches a `MessageEvent` of type `text`
- **THEN** `inbox.tasks.length` SHALL equal 1
- **AND** the task's `from` SHALL equal `event.from`

#### Scenario: windowTracker is auto-notified

- **GIVEN** a bridge constructed with a `WindowTracker`
- **WHEN** the receiver dispatches a `MessageEvent` from `+5210000000001`
- **THEN** `windowTracker.isWindowOpen("+5210000000001")` SHALL resolve to `true` after the dispatch

#### Scenario: Late delivery forwards the customer's timestamp

- **GIVEN** a bridge constructed with a `WindowTracker`
- **WHEN** the receiver dispatches a `MessageEvent` whose `timestamp` is 30 h in the past
- **THEN** `notifyInbound` SHALL have been called with `(event.from, event.timestamp)`
- **AND** `windowTracker.isWindowOpen(event.from)` SHALL resolve to `false`
- **AND** the enqueued task's `windowOpen` SHALL be `false`

#### Scenario: markAsRead is fired by default

- **GIVEN** a bridge constructed with `MockWhatsAppClient` and no `autoMarkRead` override
- **WHEN** the receiver dispatches a `MessageEvent` with `id === "wamid.X"`
- **THEN** after the next event-loop tick, `mock.markReads` SHALL contain an entry with `messageId === "wamid.X"` and `typing === true`

#### Scenario: autoMarkRead: false suppresses the ack

- **GIVEN** a bridge constructed with `autoMarkRead: false`
- **WHEN** the receiver dispatches any inbound message
- **THEN** `mock.markReads` SHALL remain empty

#### Scenario: isOnTakeover skips enqueue

- **GIVEN** a bridge whose `isOnTakeover` resolves to `true` for `+5210000000001`
- **WHEN** the receiver dispatches a `MessageEvent` from `+5210000000001`
- **THEN** `inbox.tasks.length` SHALL remain 0

#### Scenario: transform returning null skips enqueue

- **GIVEN** a bridge whose `transform` always returns `null`
- **WHEN** the receiver dispatches any inbound message
- **THEN** `inbox.tasks.length` SHALL remain 0

#### Scenario: Inbox failure does not crash the receiver dispatch

- **GIVEN** a bridge whose `inbox.append` rejects
- **AND** an `onError` spy is supplied
- **WHEN** the receiver dispatches a `MessageEvent`
- **THEN** `onError` SHALL be invoked once with the rejection error and the event
- **AND** a subsequent inbound dispatch SHALL still reach the bridge handler (no permanent breakage)

#### Scenario: dispose detaches the handler

- **GIVEN** a bridge that has dispatched one event into the inbox
- **WHEN** `dispose()` is called and a second event is dispatched
- **THEN** `inbox.tasks.length` SHALL remain 1 (the second event SHALL NOT reach the inbox)

#### Scenario: dispose is idempotent

- **WHEN** `dispose()` is called twice on the same bridge
- **THEN** no error SHALL be thrown and the second call SHALL be a no-op
