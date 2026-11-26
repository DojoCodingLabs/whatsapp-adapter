## MODIFIED Requirements

### Requirement: Polymorphic webhook payload parser

The webhook parser SHALL emit a `MessageEvent` for every entry
in `entry[i].changes[i].value.messages[i]` of the incoming
payload, preserving the documented fields (`id`, `from`,
`timestamp`, `type`, type-specific body, `context` for replies)
and, **when present in the payload**, the `referral` object
verbatim, `group_id` as `groupId` and `messages[i].errors` as
`errors`.

`MessageEvent.type` SHALL be normalised to an `IncomingMessageKind`.
Interactive replies SHALL be split by `interactive.type`:
`button_reply` → `"interactive_button_reply"`, `list_reply` →
`"interactive_list_reply"`, `nfm_reply` (WhatsApp Flows completion)
→ `"interactive_nfm_reply"`, `product` → `"interactive_product"`.
The top-level Meta types `edit` and `revoke` (Coexistence) SHALL be
preserved as `"edit"` and `"revoke"`. The top-level Meta type
`request_welcome` SHALL be preserved as `"request_welcome"` and
documented as deprecated (Meta removed the feature on 2026-03-27).
Only types the SDK does not recognise SHALL collapse to
`"unsupported"`, so that value is never ambiguous with a documented
Meta type.

The `referral` field SHALL be typed as
`WhatsAppReferral & Record<string, unknown>` so:

- TypeScript narrows the documented core fields (`ctwa_clid`,
  `source_url`, `source_type`, `source_id`, `headline`, `body`,
  `media_type`, `image_url`, `video_url`, `thumbnail_url`,
  `welcome_message.text`), with `media_url` and
  `welcome_message.message_id` kept as deprecated optional keys.
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

#### Scenario: Interactive product is not unsupported

- **GIVEN** Meta's documented single-product message (`interactive.type: "product"`)
- **WHEN** the payload is parsed
- **THEN** `event.type` SHALL be `"interactive_product"`

#### Scenario: Group id and message errors are surfaced

- **GIVEN** a message with `group_id: "GROUP-1"`, and an `unsupported` message with `errors[0].error_data.details`
- **WHEN** the payload is parsed
- **THEN** the first event SHALL have `groupId === "GROUP-1"`
- **AND** the second SHALL expose `errors[0].error_data.details`

### Requirement: Webhook dedupe by wamid

The package SHALL export a `WebhookDeduper(storage, ttlMs)` whose `markIfNew(eventKey)` returns `true` when the event was not seen within the TTL window and `false` when it was. The default TTL (`WEBHOOK_DEDUPE_TTL_MS`) SHALL be 7 days, matching Meta's documented redelivery window, and the documentation SHALL state the storage cost and the `dedupeTtlMs` override. The receiver SHALL skip dispatch for any `message` event whose `wamid` was already seen, and any `status` event whose `id` was already seen with the same `status` value.

#### Scenario: First sighting of a wamid is new

- **WHEN** `await deduper.markIfNew("wamid.abc")`
- **THEN** the return value is `true`

#### Scenario: Second sighting within TTL is duplicate

- **WHEN** the same wamid is `markIfNew`-ed twice in a row
- **THEN** the second call returns `false`

#### Scenario: Sighting after TTL expiry is treated as new again

- **WHEN** `markIfNew("wamid.abc")` is called, time advances past the TTL, and `markIfNew("wamid.abc")` is called again
- **THEN** the second call returns `true`

#### Scenario: A redelivery six days later is still a duplicate by default

- **GIVEN** a deduper constructed without an explicit TTL
- **WHEN** a key is marked and the same key is marked again six days later
- **THEN** the second call returns `false`

### Requirement: Framework-agnostic WebhookReceiver
The package SHALL export `WebhookReceiver` whose constructor accepts `{ appSecret, verifyToken, storage?, dedupeTtlMs?, onError? }`. It SHALL expose:
- `.on(kind, handler)` to register a handler per event kind (`message`, `status`, `template_status`, `template_quality`, `template_category`, `phone_number_quality`, `account_alert`, `account_review`, `user_preferences`, `webhook_error`, `unknown`, `error`).
- `.handleVerifyRequest({ mode, verifyToken, challenge })` returning `{ status: 200, body: string } | { status: 403 }`.
- `.handlePayload(rawBody, signatureHeader, parsedBody)` that synchronously verifies the signature, parses the payload, dedupes, and returns `{ status: 200, dispatchPromise }` so callers can ack 200 quickly while handlers run async on the returned promise.
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
- **AND** the dedupe key is derived from the user identity (`waId`, or `bsuid:<userId>` when `waId` is empty), `category`, `value` and `timestamp` (the field carries no wamid)

#### Scenario: Two username-only users opting out in the same second both dispatch
- **GIVEN** two `user_preferences` entries with no `wa_id`, different `user_id`s, the same `category`, `value` and `timestamp`
- **WHEN** both are dispatched
- **THEN** the handler is invoked twice, once per `userId`

### Requirement: Every webhook handler invocation emits an OTel span
`WebhookReceiver._dispatch` SHALL wrap each handler invocation in a `withSpan("whatsapp.webhook.dispatch", …)`. The span SHALL carry attributes:
- `whatsapp.event.kind` — the event's `kind` (`message`, `status`, `template_status`, etc.)
- `whatsapp.waba_id` — hashed
- `whatsapp.phone_number_id` — hashed (if present on the event)
- `whatsapp.event.id` — for `message`/`status` events only; the `wamid` hashed with the same salted helper and receiver `redactSalt` (a raw wamid SHALL NOT appear in any attribute)

When the handler throws, the span SHALL be recorded with `SpanStatusCode.ERROR` and the exception event attached.

#### Scenario: A registered message handler is invoked under a span
- **WHEN** a test handler runs to completion via `receiver.handlePayload(...)`
- **THEN** the exporter records exactly one `whatsapp.webhook.dispatch` span per handler invocation
- **AND** the span's `attributes["whatsapp.event.kind"] === "message"`
- **AND** `attributes["whatsapp.event.id"]` equals `hashPhoneNumberId(wamid, redactSalt)` and no attribute contains the raw wamid

#### Scenario: A throwing handler records ERROR status on its span
- **WHEN** a registered `message` handler throws
- **THEN** the dispatch span for that invocation has `status.code === SpanStatusCode.ERROR`
- **AND** the span includes an `exception` event whose attribute `exception.message` matches the thrown error

### Requirement: user_preferences webhook field is parsed into UserPreferencesEvent
The parser SHALL handle the `user_preferences` change field (Meta's marketing opt-out / opt-in signal) and emit one `UserPreferencesEvent` per entry in `value.user_preferences[]`:

```ts
interface UserPreferencesEvent extends BaseEvent {
  kind: "user_preferences";
  waId: string; // entry.wa_id, falling back to value.contacts[0].wa_id, else ""
  userId?: string; // entry.user_id (BSUID), falling back to the single contact's user_id
  parentUserId?: string; // entry.parent_user_id
  category: "marketing_messages" | (string & {});
  value: "stop" | "resume" | (string & {});
  detail?: string;
  raw: Record<string, unknown>;
}
```

`timestamp` SHALL be the entry's own `timestamp` normalised to epoch ms (falling back to receipt time); `phoneNumberId` / `displayPhoneNumber` SHALL be copied from `value.metadata`. The type SHALL be exported from the package root and `EventKindMap` SHALL include `user_preferences` so `.on("user_preferences", h)` is typed. Documentation SHALL show wiring the event to `OptInRegistry.optOut` / `optIn` scoped to `category: "MARKETING"`, and SHALL state that `waId` is `""` for username users without a shareable phone (key on `userId` then).

#### Scenario: Stop preference is parsed
- **GIVEN** a `user_preferences` payload whose entry has `wa_id: "521234567890"`, `category: "marketing_messages"`, `value: "stop"`, `detail: "User requested to stop marketing messages"`, `timestamp: "1735689601"`
- **WHEN** the payload is parsed
- **THEN** exactly one event is emitted with `kind === "user_preferences"`, `waId === "521234567890"`, `value === "stop"`, `detail` preserved and `timestamp === 1735689601000`

#### Scenario: wa_id falls back to contacts[0] and multiple entries emit multiple events
- **GIVEN** a payload whose entries omit `wa_id` but `value.contacts[0].wa_id` is `"5219999"`, with two entries (`stop` then `resume`)
- **WHEN** the payload is parsed
- **THEN** two events are emitted, both with `waId === "5219999"`, in payload order

#### Scenario: BSUID-only preference carries userId
- **GIVEN** an entry with `user_id: "US.1"`, `parent_user_id: "US.ENT.1"` and no `wa_id` anywhere
- **WHEN** the payload is parsed
- **THEN** the event has `waId === ""`, `userId === "US.1"` and `parentUserId === "US.ENT.1"`

#### Scenario: Event drives an OptInRegistry
- **GIVEN** a handler that calls `registry.optOut(e.waId, { category: "MARKETING" })` on `value === "stop"`
- **WHEN** a stop preference is dispatched
- **THEN** `registry.isOptedIn(waId, { category: "MARKETING" })` resolves to `false`
- **AND** `registry.isOptedIn(waId, { category: "UTILITY" })` still resolves to `true`

### Requirement: Status events surface Meta's pricing envelope

For every entry in `entry[i].changes[i].value.statuses[i]` the parser SHALL emit a `StatusEvent` and, **when present in the payload and of the expected primitive type**, lift the following fields verbatim:

- `pricing.category` → `pricingCategory: string`
- `pricing.type` → `pricingType: string` (Meta values include `regular`, `free_customer_service`, `free_group_customer_service`, `free_entry_point`)
- `pricing.subtype` → `pricingSubtype: string` (Meta values: `free_tier`, `paid_exempt`)
- `pricing.pricing_model` → `pricingModel: string` (Meta values: `PMP`, `CBP`)
- `pricing.billable` → `billable: boolean` (documented as slated for deprecation by Meta)
- `conversation.id` → `conversationId: string`
- `recipient_user_id` → `recipientUserId`, `recipient_parent_user_id` → `recipientParentUserId`, `recipient_type` → `recipientType`, `recipient_participant_id` → `recipientParticipantId`, `recipient_identity_key_hash` → `recipientIdentityKeyHash`, `biz_opaque_callback_data` → `bizOpaqueCallbackData`

The matching `value.contacts[]` entry (by `recipient_id`, then `recipient_user_id`, then the single contact of a single-status batch) SHALL be exposed as `contact`. `errors` SHALL be typed with `code`, `title`, `message`, `error_data.details` and `href`. Documentation SHALL state that `pricing` may arrive on `sent` and on one of `delivered` / `read`.

When a source field is absent or not of the expected type, the corresponding `StatusEvent` key SHALL be omitted (not present with value `undefined`). The parser SHALL NOT throw on unrecognised `pricing` shapes and SHALL NOT constrain the string fields to a closed union, because Meta has added values without a version bump.

#### Scenario: Per-message-pricing status lifts every pricing field

- **GIVEN** a `statuses[0]` with `pricing: { billable: false, pricing_model: "PMP", category: "service", type: "free_customer_service" }` and no `conversation` object
- **WHEN** `parseWebhookPayload(...)` is called
- **THEN** the `StatusEvent` has `pricingModel === "PMP"`, `pricingCategory === "service"`, `pricingType === "free_customer_service"`, `billable === false`
- **AND** `conversationId` is `undefined`

#### Scenario: Legacy conversation-based-pricing status still parses

- **GIVEN** a `statuses[0]` with `conversation: { id: "conv-1" }` and `pricing: { billable: true, pricing_model: "CBP", category: "utility" }`
- **WHEN** the payload is parsed
- **THEN** `conversationId === "conv-1"`, `pricingModel === "CBP"`, `pricingCategory === "utility"`, `billable === true`
- **AND** `pricingType` is `undefined`

#### Scenario: Status without a pricing object omits the pricing keys

- **GIVEN** a `statuses[0]` of `status: "failed"` with `errors[]` and no `pricing` key
- **WHEN** the payload is parsed
- **THEN** `"pricingType" in event`, `"pricingModel" in event` and `"billable" in event` are all `false`

#### Scenario: Delivered status sent to a BSUID

- **GIVEN** Meta's documented delivered status with `recipient_user_id`, `recipient_parent_user_id`, no `recipient_id`, and a contact with `username`
- **WHEN** the payload is parsed
- **THEN** `recipientUserId` and `recipientParentUserId` are set, `recipientId` is absent, `pricingCategory === "marketing"` and `contact.username` is set

#### Scenario: Subtype and callback data are lifted

- **GIVEN** a status with `pricing.subtype: "free_tier"` and `biz_opaque_callback_data: "order-42"`
- **WHEN** the payload is parsed
- **THEN** `pricingSubtype === "free_tier"` and `bizOpaqueCallbackData === "order-42"`

## ADDED Requirements

### Requirement: Inbound sender identity is BSUID-aware

`MessageEvent` SHALL expose `fromUserId` (BSUID from `from_user_id` or the joined contact), `fromParentUserId` and `contact` joined from `value.contacts[]` by `wa_id`, else `user_id`, else the single contact of a single-message batch; the parser SHALL NOT guess between unmatched contacts. `from` SHALL remain a `string`, documented as `""` when Meta omits it. Dedupe SHALL stay keyed on the wamid. Absent payload keys SHALL be absent on the event.

#### Scenario: Username user without a phone number

- **GIVEN** Meta's documented "text message from a user with a username" payload (no `from`, `from_user_id: "US.13491208655302741918"`, contact with `username`)
- **WHEN** the payload is parsed
- **THEN** `from === ""`, `fromUserId === "US.13491208655302741918"` and `contact` holds `userId`, `username` and `profileName`

#### Scenario: Several contacts are matched by identifier, not position

- **GIVEN** two contacts and three messages, the third from a phone that matches neither contact
- **WHEN** the payload is parsed
- **THEN** the first two messages get their matching contact and the third gets no `contact`

#### Scenario: Legacy phone-only payload is unchanged

- **GIVEN** a payload with `from` and no BSUID fields
- **WHEN** the payload is parsed
- **THEN** `fromUserId` and `groupId` are not present on the event

### Requirement: Typed message accessors

The package SHALL export pure, never-throwing helpers over `MessageEvent`: `messageSenderKey` (phone, else BSUID, else `""`), `messageText`, `messageReplyId`, `messageMedia`, `messageReferral` (camelCase, current CTWA fields) and `messageIdentityChange` (`user_changed_user_id` / `user_changed_number`). Each SHALL return `undefined` for shapes it does not recognise.

#### Scenario: BSUID rotation exposes previous and new ids

- **GIVEN** Meta's documented `user_changed_user_id` system payload
- **WHEN** `messageIdentityChange(event)` is called
- **THEN** it returns `userId`, `parentUserId`, `previousUserId` and `previousParentUserId` from `system`

#### Scenario: Voice note media

- **GIVEN** Meta's documented audio payload with `voice: true`
- **WHEN** `messageMedia(event)` is called
- **THEN** it returns `kind: "audio"`, the media `id`, `mimeType`, `sha256`, `url` and `voice: true`

#### Scenario: Sender key falls back to the BSUID

- **GIVEN** a message with `from === ""` and `fromUserId === "US.1"`
- **WHEN** `messageSenderKey(event)` is called
- **THEN** it returns `"US.1"`

### Requirement: Value-level webhook errors are surfaced

When a `messages` change carries a non-empty `value.errors` array, the parser SHALL emit one `WebhookErrorEvent` (`kind: "webhook_error"`, `field`, `errors`, plus metadata phone ids) in addition to any messages / statuses in the same change. The receiver SHALL dispatch it to `.on("webhook_error", h)` and SHALL NOT dedupe it.

#### Scenario: Errors-only change is not dropped

- **GIVEN** a `messages` change whose value carries only `errors: [{ code: 131000, ... }]`
- **WHEN** the payload is parsed
- **THEN** exactly one `webhook_error` event is emitted carrying that error

#### Scenario: Empty or malformed errors produce no event

- **GIVEN** a `messages` change with `errors: []` or `errors: "nope"`
- **WHEN** the payload is parsed
- **THEN** no events are emitted
