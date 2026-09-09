## MODIFIED Requirements

### Requirement: Polymorphic webhook payload parser

The webhook parser SHALL emit a `MessageEvent` for every entry
in `entry[i].changes[i].value.messages[i]` of the incoming
payload, preserving the documented fields (`id`, `from`,
`timestamp`, `type`, type-specific body, `context` for replies)
and, **when present in the payload**, the `referral` object
verbatim.

`MessageEvent.type` SHALL be normalised to an `IncomingMessageKind`.
Interactive replies SHALL be split by `interactive.type`:
`button_reply` → `"interactive_button_reply"`, `list_reply` →
`"interactive_list_reply"`, `nfm_reply` (WhatsApp Flows completion)
→ `"interactive_nfm_reply"`. The top-level Meta type
`request_welcome` (Click-to-WhatsApp conversation opened before the
user typed) SHALL be preserved as `"request_welcome"`. Only types the
SDK does not recognise SHALL collapse to `"unsupported"`, so that
value is never ambiguous with a documented Meta type.

The `referral` field SHALL be typed as
`WhatsAppReferral & Record<string, unknown>` so:

- TypeScript narrows the documented core fields (`ctwa_clid`,
  `source_url`, `source_type`, `source_id`, `headline`, `body`,
  `media_type`, `media_url`, `thumbnail_url`, `welcome_message`).
- Unknown additional fields Meta may introduce in the future
  are preserved at runtime without requiring an SDK release.

When `messages[i].referral` is absent, `event.referral` SHALL
be `undefined`. When `messages[i].referral` is an empty object,
`event.referral` SHALL be `{}` (preserved). The parser SHALL
NOT throw on unrecognised `referral` shapes.

#### Scenario: CTWA-tagged inbound message exposes `ctwa_clid`

- **GIVEN** an incoming webhook payload where `messages[0].referral.ctwa_clid` is `"ARZxq..."`
- **WHEN** `parseWebhookPayload(...)` is called
- **THEN** the emitted `MessageEvent.referral.ctwa_clid` SHALL be `"ARZxq..."`
- **AND** every other documented field of `referral` SHALL be preserved byte-identically

#### Scenario: Empty `referral` object is preserved

- **GIVEN** an incoming webhook payload where `messages[0].referral` is `{}`
- **WHEN** the payload is parsed
- **THEN** `event.referral` SHALL be `{}` (NOT `undefined`)

#### Scenario: Message without `referral` produces undefined

- **GIVEN** an incoming webhook payload where `messages[0]` has no `referral` key
- **WHEN** the payload is parsed
- **THEN** `event.referral` SHALL be `undefined`

#### Scenario: Unknown extra fields inside `referral` are preserved

- **GIVEN** an incoming webhook payload where `messages[0].referral` contains a field Meta added after this SDK release (e.g. `referral.future_field: "x"`)
- **WHEN** the payload is parsed
- **THEN** `event.referral.future_field` at runtime SHALL be `"x"`
- **AND** the parser SHALL NOT throw

#### Scenario: WhatsApp Flows completion is typed

- **GIVEN** an inbound message with `type: "interactive"` and `interactive.type: "nfm_reply"`
- **WHEN** the payload is parsed
- **THEN** `event.type` SHALL be `"interactive_nfm_reply"`
- **AND** `event.body.interactive.nfm_reply.response_json` SHALL be preserved as the raw JSON string

#### Scenario: CTWA welcome trigger is typed

- **GIVEN** an inbound message with `type: "request_welcome"` and a `referral` object
- **WHEN** the payload is parsed
- **THEN** `event.type` SHALL be `"request_welcome"`
- **AND** `event.referral` SHALL be preserved

### Requirement: Framework-agnostic WebhookReceiver
The package SHALL export `WebhookReceiver` whose constructor accepts `{ appSecret, verifyToken, storage?, dedupeTtlMs?, onError? }`. It SHALL expose:
- `.on(kind, handler)` to register a handler per event kind (`message`, `status`, `template_status`, `template_quality`, `template_category`, `phone_number_quality`, `account_alert`, `account_review`, `user_preferences`, `unknown`, `error`).
- `.handleVerifyRequest({ mode, verifyToken, challenge })` returning `{ status: 200, body: string } | { status: 403 }`.
- `.handlePayload(rawBody, signatureHeader, parsedBody)` that synchronously verifies the signature, parses the payload, dedupes, and returns `{ status: 200, dispatchPromise }` so callers can ack 200 within 30 s while handlers run async on the returned promise.
- `.handlePayload` SHALL return `{ status: 401 }` if the signature does not verify (without invoking any handler).

#### Scenario: Successful end-to-end dispatch
- **WHEN** the receiver registers `.on("message", h)`, then `.handlePayload(rawBody, sig, parsed)` is called with a valid signature and a fixture-payload containing one message
- **THEN** the result is `{ status: 200, dispatchPromise }`
- **AND** awaiting `dispatchPromise` invokes `h` exactly once with the parsed message event

#### Scenario: Bad signature short-circuits to 401 with no handler invocation
- **WHEN** `.handlePayload(rawBody, "sha256=BAD", parsed)` is called
- **THEN** the result is `{ status: 401 }`
- **AND** no registered handler is invoked

#### Scenario: Duplicate wamid is filtered before dispatch
- **WHEN** `.handlePayload` is called twice with the same valid signature and the same parsed payload
- **THEN** both calls return `{ status: 200, dispatchPromise }`
- **AND** awaiting both dispatch promises invokes the registered `message` handler only once total

#### Scenario: Handler error fires `error` event without breaking dispatch
- **WHEN** a registered `message` handler throws and `.on("error", errH)` is registered
- **THEN** `errH` is invoked with the thrown error (and the originating event)
- **AND** other registered handlers for other events still run

#### Scenario: user_preferences dispatches to a typed handler and dedupes replays
- **WHEN** the receiver registers `.on("user_preferences", h)` and `.handlePayload` is called twice with the same valid `user_preferences` payload
- **THEN** `h` is invoked exactly once with a `UserPreferencesEvent`
- **AND** the dedupe key is derived from `waId`, `category`, `value` and `timestamp` (the field carries no wamid)

## ADDED Requirements

### Requirement: user_preferences webhook field is parsed into UserPreferencesEvent
The parser SHALL handle the `user_preferences` change field (Meta's marketing opt-out / opt-in signal) and emit one `UserPreferencesEvent` per entry in `value.user_preferences[]`:

```ts
interface UserPreferencesEvent extends BaseEvent {
  kind: "user_preferences";
  waId: string; // entry.wa_id, falling back to value.contacts[0].wa_id
  category: "marketing_messages" | (string & {});
  value: "stop" | "resume" | (string & {});
  detail?: string;
  raw: Record<string, unknown>;
}
```

`timestamp` SHALL be the entry's own `timestamp` normalised to epoch ms (falling back to receipt time); `phoneNumberId` / `displayPhoneNumber` SHALL be copied from `value.metadata`. The type SHALL be exported from the package root and `EventKindMap` SHALL include `user_preferences` so `.on("user_preferences", h)` is typed. Documentation SHALL show wiring the event to `OptInRegistry.optOut` / `optIn` scoped to `category: "MARKETING"`.

#### Scenario: Stop preference is parsed
- **GIVEN** a `user_preferences` payload whose entry has `wa_id: "521234567890"`, `category: "marketing_messages"`, `value: "stop"`, `detail: "User requested to stop marketing messages"`, `timestamp: "1735689601"`
- **WHEN** the payload is parsed
- **THEN** exactly one event is emitted with `kind === "user_preferences"`, `waId === "521234567890"`, `value === "stop"`, `detail` preserved and `timestamp === 1735689601000`

#### Scenario: wa_id falls back to contacts[0] and multiple entries emit multiple events
- **GIVEN** a payload whose entries omit `wa_id` but `value.contacts[0].wa_id` is `"5219999"`, with two entries (`stop` then `resume`)
- **WHEN** the payload is parsed
- **THEN** two events are emitted, both with `waId === "5219999"`, in payload order

#### Scenario: Event drives an OptInRegistry
- **GIVEN** a handler that calls `registry.optOut(e.waId, { category: "MARKETING" })` on `value === "stop"`
- **WHEN** a stop preference is dispatched
- **THEN** `registry.isOptedIn(waId, { category: "MARKETING" })` resolves to `false`
- **AND** `registry.isOptedIn(waId, { category: "UTILITY" })` still resolves to `true`
