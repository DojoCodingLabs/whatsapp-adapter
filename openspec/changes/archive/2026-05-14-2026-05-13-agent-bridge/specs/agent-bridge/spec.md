## ADDED Requirements

### Requirement: AgentInbox interface

The SDK SHALL export an `AgentInbox` interface with a single
async method `append(task: AgentTask): Promise<void>`. The
interface SHALL be pluggable — any consumer can implement it
against an arbitrary backend (in-memory, Redis Streams, BullMQ,
Postgres LISTEN/NOTIFY, SQS, etc.). The shape mirrors the SDK's
`Storage` and `OptInRegistry` interfaces: small, async,
deliberate.

```ts
export interface AgentInbox {
  append(task: AgentTask): Promise<void>;
}
```

The SDK SHALL NOT define `flush`, `close`, or any lifecycle
method on the interface — bridge consumers own the inbox
lifecycle independently from the bridge.

#### Scenario: AgentInbox is the only required collaborator besides receiver and client

- **WHEN** `createAgentBridge({ receiver, client, inbox })` is called with an `inbox` implementing `AgentInbox` and the other two required arguments
- **THEN** the bridge SHALL construct without further configuration

#### Scenario: InMemoryAgentInbox ships as the default reference implementation

- **GIVEN** the SDK barrel exports
- **THEN** `InMemoryAgentInbox` SHALL be importable from `@dojocoding/whatsapp-sdk`
- **AND** `new InMemoryAgentInbox()` SHALL satisfy the `AgentInbox` interface
- **AND** the instance SHALL expose a `tasks: ReadonlyArray<AgentTask>` accessor and a `reset()` method for tests

### Requirement: AgentTask normalised payload shape

The SDK SHALL export an `AgentTask` type produced by the
bundled `defaultAgentTransform(event: MessageEvent): AgentTask`
function. The task SHALL flatten the most-needed fields out of
the typed `MessageEvent` so consumer agent runtimes do not need
to re-parse Meta's wire shape per inbound message.

The minimum fields the default transform SHALL extract are:

- `receivedAt: number` — `event.timestamp`.
- `wabaPhoneNumberId: string` — `event.phoneNumberId` when
  present.
- `conversationId: string` — defaults to `event.from`.
- `from: string` — `event.from`.
- `wamid: string` — `event.id`.
- `type: IncomingMessageKind` — `event.type`.
- `text?: string` — extracted from `event.body.text.body` when
  the type is `text`.
- `mediaIds?: ReadonlyArray<string>` — extracted from
  `event.body[<type>].id` for `image` / `video` / `audio` /
  `document` / `sticker` types.
- `buttonReplyId?: string` — extracted from
  `event.body.interactive.button_reply.id` for
  `interactive_button_reply` type.
- `listReplyId?: string` — extracted from
  `event.body.interactive.list_reply.id` for
  `interactive_list_reply` type.
- `location?: { latitude: number; longitude: number; name?: string; address?: string }` — extracted for `location` type.
- `replyToWamid?: string` — extracted from `event.contextId`
  when present.
- `ctwaReferral?: MessageEvent["referral"]` — propagated
  verbatim from `event.referral` when present.
- `windowOpen?: boolean` — only set when the bridge has a
  `windowTracker` and queries it AFTER the auto-notify; absent
  when no tracker is configured.
- `raw: MessageEvent` — the original event, unmodified, as the
  escape hatch.

The `defaultAgentTransform` SHALL be exported so consumers
writing their own transform can compose it:

```ts
transform: (event) => ({ ...defaultAgentTransform(event), tenantId: resolveTenant(event) })
```

#### Scenario: defaultAgentTransform extracts text from a text message

- **GIVEN** a `MessageEvent` of type `text` with `body.text.body === "hola"`
- **WHEN** `defaultAgentTransform(event)` is called
- **THEN** the returned task SHALL have `text === "hola"`
- **AND** the task SHALL have `type === "text"`
- **AND** `mediaIds` SHALL be `undefined`

#### Scenario: defaultAgentTransform extracts mediaIds from an image message

- **GIVEN** a `MessageEvent` of type `image` with `body.image.id === "media-123"`
- **WHEN** `defaultAgentTransform(event)` is called
- **THEN** the returned task SHALL have `mediaIds === ["media-123"]`

#### Scenario: defaultAgentTransform extracts a button reply id

- **GIVEN** a `MessageEvent` of type `interactive_button_reply` with `body.interactive.button_reply.id === "yes"`
- **WHEN** `defaultAgentTransform(event)` is called
- **THEN** the returned task SHALL have `buttonReplyId === "yes"`
- **AND** the task SHALL have `type === "interactive_button_reply"`

#### Scenario: defaultAgentTransform propagates the CTWA referral verbatim

- **GIVEN** a `MessageEvent` with a `referral` object containing `ctwa_clid`
- **WHEN** `defaultAgentTransform(event)` is called
- **THEN** the returned task's `ctwaReferral` SHALL deep-equal `event.referral`

#### Scenario: defaultAgentTransform preserves the raw event

- **GIVEN** any `MessageEvent`
- **WHEN** `defaultAgentTransform(event)` is called
- **THEN** `task.raw` SHALL be the same reference as the input `event`

### Requirement: createAgentBridge dispatch contract

The SDK SHALL export `createAgentBridge(input): AgentBridge`
that registers a `receiver.on("message", handler)` and returns
`{ dispose(): void }`. The handler SHALL execute the following
steps in order for every dispatched inbound `MessageEvent`:

1. **Window tracker auto-notify.** If `input.windowTracker` is
   defined, the handler SHALL call
   `windowTracker.notifyInbound(event.from)` before proceeding.
   This step SHALL be `await`ed so subsequent state reads see
   the post-notify state.

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

### Requirement: Out of scope — agent runtime, status events, queue backends

The agent-bridge capability SHALL NOT include:

- A built-in agent runner (LLM-call orchestration is consumer-
  side).
- Conversation-state persistence (lives in
  `@dojocoding/conversation-state`).
- A Redis Streams / Postgres LISTEN / SQS adapter (only
  `InMemoryAgentInbox` ships; production adapters are
  consumer-side, mirroring the `Storage` adapter posture).
- Status-event routing (`StatusEvent`s flow through the
  consumer's separate `receiver.on("status", h)` handler
  unchanged).

These exclusions ensure the bridge stays a routing primitive
and does not foreclose decisions the consumer needs to make
against a stable interface.

#### Scenario: Status events are not enqueued by the bridge

- **GIVEN** a bridge attached to a receiver
- **WHEN** the receiver dispatches a `StatusEvent`
- **THEN** `inbox.tasks.length` SHALL remain unchanged
- **AND** any registered `receiver.on("status", h)` handler SHALL fire as normal
