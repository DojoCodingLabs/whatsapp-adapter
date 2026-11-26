## MODIFIED Requirements

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
- `conversationId: string` — defaults to `messageSenderKey(event)`
  (`event.from` when non-empty, else `event.fromUserId`).
- `from: string` — `event.from` (may be `""` for username users).
- `fromUserId?: string` — `event.fromUserId` when present.
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

#### Scenario: BSUID-only sender keys the conversation on the BSUID

- **GIVEN** a `MessageEvent` with `from === ""` and `fromUserId === "US.1"`
- **WHEN** the bridge dispatches it with a `windowTracker`
- **THEN** the task has `conversationId === "US.1"` and `fromUserId === "US.1"`
- **AND** the tracker's window is open for `"US.1"`, not for `""`

#### Scenario: Phone senders keep the phone as conversationId

- **GIVEN** a `MessageEvent` with a non-empty `from` and a `fromUserId`
- **WHEN** `defaultAgentTransform(event)` is called
- **THEN** `conversationId === event.from`
