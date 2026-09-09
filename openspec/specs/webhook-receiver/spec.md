# webhook-receiver Specification

## Purpose
TBD - created by archiving change bootstrap-whatsapp-adapter. Update Purpose after archive.
## Requirements
### Requirement: Typed error hierarchy with discriminator codes
The package SHALL export a base `WhatsAppError` class extending the built-in `Error`, plus the following subclasses, each with a unique `readonly code` discriminator string: `MissingCredentialsError` (`"MISSING_CREDENTIALS"`), `RateLimitError` (`"RATE_LIMIT"`), `WindowClosedError` (`"WINDOW_CLOSED"`), `WebhookSignatureError` (`"WEBHOOK_SIGNATURE"`), `TemplateError` (`"TEMPLATE"`), `MockModeError` (`"MOCK_MODE"`).

The base class SHALL set the prototype chain correctly so that `instanceof` checks work across module boundaries (`Object.setPrototypeOf(this, new.target.prototype)`). Every subclass instance SHALL be both `instanceof <Subclass>` and `instanceof WhatsAppError`.

#### Scenario: Subclass instanceof base class
- **WHEN** a `WebhookSignatureError` is thrown and caught
- **THEN** `error instanceof WebhookSignatureError === true`
- **AND** `error instanceof WhatsAppError === true`
- **AND** `error instanceof Error === true`

#### Scenario: Discriminator code is set
- **WHEN** any subclass is constructed
- **THEN** `error.code` equals the subclass's documented discriminator string
- **AND** `error.code` is `readonly` (TypeScript strict reports an error on reassignment)

#### Scenario: Errors serialize without leaking sensitive context
- **WHEN** a `WhatsAppError` instance is `JSON.stringify`'d
- **THEN** the output contains `name`, `code`, and `message` fields
- **AND** the output SHALL NOT include any `token`, `appSecret`, or raw webhook body fields

### Requirement: Webhook ack deadline exposed as a constant
The package SHALL export a `WEBHOOK_ACK_DEADLINE_MS` constant set to `30_000` (30 seconds) so that the receiver implementation in Phase 3 and any consumer middleware can refer to a single source of truth for the deadline within which Meta expects a 200 response.

#### Scenario: Constant value
- **WHEN** the consumer imports `WEBHOOK_ACK_DEADLINE_MS`
- **THEN** the value is exactly `30000`

### Requirement: Customer-service-window TTL exposed as a constant
The package SHALL export a `WINDOW_TTL_MS` constant set to `86_400_000` (24 hours in milliseconds), to be consumed by the `WindowTracker` capability in Phase 4.

#### Scenario: Constant value
- **WHEN** the consumer imports `WINDOW_TTL_MS`
- **THEN** the value is exactly `24 * 60 * 60 * 1000`

### Requirement: Timing-safe HMAC-SHA256 signature verification

The package SHALL export `verifySignature({ rawBody, signatureHeader, appSecret })` that returns a Promise resolving to `true` if and only if the HMAC-SHA256 of the **raw bytes** of `rawBody` keyed with `appSecret` matches the hex value in `signatureHeader`. Comparison SHALL be timing-safe (a constant-time `Uint8Array` byte-wise compare; no early-exit on first mismatch). The HMAC computation SHALL use `crypto.subtle.sign("HMAC", ...)` so the function runs unmodified on Node ≥ 20, Cloudflare Workers, Bun, Deno, and any WinterCG-compliant runtime. The `sha256=` prefix SHALL be tolerated and stripped. `rawBody` SHALL accept `Buffer | Uint8Array | string`.

#### Scenario: Valid signature returns true

- **WHEN** `signatureHeader === "sha256=" + hmacSha256Hex(appSecret, rawBody)`
- **THEN** `await verifySignature(...)` resolves to `true`

#### Scenario: Tampered body returns false (without throwing)

- **WHEN** the rawBody is altered by one byte after the signature was computed
- **THEN** `await verifySignature(...)` resolves to `false`

#### Scenario: Mismatched `appSecret` returns false

- **WHEN** the signature was computed with one secret but verified with another
- **THEN** `await verifySignature(...)` resolves to `false`

#### Scenario: Missing or malformed header returns false

- **WHEN** `signatureHeader` is `undefined`, `""`, `"sha256="`, `"not-hex"`, or hex of the wrong length
- **THEN** `await verifySignature(...)` resolves to `false` (no throw)

#### Scenario: WebCrypto and node:crypto produce identical digests

- **WHEN** the same `(rawBody, appSecret)` pair is fed to both `crypto.subtle.sign("HMAC", ...)` and `node:crypto.createHmac("sha256", appSecret).update(rawBody).digest()`
- **THEN** the two digest byte arrays are byte-equal

### Requirement: Webhook verify-token handshake

The package SHALL export `verifyHandshake({ mode, verifyToken, challenge, expectedToken })` that returns the `challenge` value when `mode === "subscribe"` AND `verifyToken === expectedToken`. The string compare SHALL be timing-safe via a length-prefix check followed by a constant-time byte-wise compare; the implementation SHALL NOT depend on `node:crypto.timingSafeEqual` so it runs on WinterCG runtimes. Otherwise returns `null`.

#### Scenario: Valid handshake echoes the challenge

- **WHEN** `verifyHandshake({ mode: "subscribe", verifyToken: "abc", challenge: "1234", expectedToken: "abc" })`
- **THEN** the return value is `"1234"`

#### Scenario: Wrong token returns null

- **WHEN** `verifyHandshake({ mode: "subscribe", verifyToken: "wrong", challenge: "1234", expectedToken: "abc" })`
- **THEN** the return value is `null`

#### Scenario: Wrong mode returns null

- **WHEN** `verifyHandshake({ mode: "unsubscribe", verifyToken: "abc", challenge: "1234", expectedToken: "abc" })`
- **THEN** the return value is `null`

#### Scenario: Verify-token compare is timing-safe

- **WHEN** two strings of equal length differ only in the last byte vs. only in the first byte
- **THEN** `verifyHandshake` returns `null` in both cases
- **AND** the runtime of both calls is bounded by the same upper limit (no early-exit data leak)

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

### Requirement: Pluggable Storage interface and InMemoryStorage
The package SHALL export a `Storage` interface with three async methods: `get<T>(key) → Promise<T | undefined>`, `set<T>(key, value, ttlMs) → Promise<void>`, `delete(key) → Promise<void>`. An `InMemoryStorage` class SHALL implement it using `Map` and TTL semantics (entries past their `expiresAt` SHALL NOT be returned). The default instance SHALL NOT spawn background timers; expired entries are cleaned lazily on access.

#### Scenario: Set then get within TTL returns value
- **WHEN** `await storage.set("k", 1, 60_000); await storage.get("k")`
- **THEN** the result is `1`

#### Scenario: After TTL expiry, get returns undefined
- **WHEN** `await storage.set("k", 1, 100); … advance time by 200 ms … await storage.get("k")`
- **THEN** the result is `undefined`

#### Scenario: Delete is idempotent
- **WHEN** `await storage.delete("nonexistent")`
- **THEN** no error is thrown

### Requirement: Webhook dedupe by wamid

The package SHALL export a `WebhookDeduper(storage, ttlMs)` whose `markIfNew(eventKey)` returns `true` when the event was not seen within the TTL window and `false` when it was. The default TTL SHALL be 24 hours. The receiver SHALL skip dispatch for any `message` event whose `wamid` was already seen, and any `status` event whose `id` was already seen with the same `status` value.

#### Scenario: First sighting of a wamid is new

- **WHEN** `await deduper.markIfNew("wamid.abc")`
- **THEN** the return value is `true`

#### Scenario: Second sighting within TTL is duplicate

- **WHEN** the same wamid is `markIfNew`-ed twice in a row
- **THEN** the second call returns `false`

#### Scenario: Sighting after TTL expiry is treated as new again

- **WHEN** `markIfNew("wamid.abc")` is called, time advances past the TTL, and `markIfNew("wamid.abc")` is called again
- **THEN** the second call returns `true`

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

### Requirement: Every webhook handler invocation emits an OTel span
`WebhookReceiver._dispatch` SHALL wrap each handler invocation in a `withSpan("whatsapp.webhook.dispatch", …)`. The span SHALL carry attributes:
- `whatsapp.event.kind` — the event's `kind` (`message`, `status`, `template_status`, etc.)
- `whatsapp.waba_id` — hashed
- `whatsapp.phone_number_id` — hashed (if present on the event)
- `whatsapp.event.id` — for `message`/`status` events only; the `wamid` (NOT hashed — it is not PII)

When the handler throws, the span SHALL be recorded with `SpanStatusCode.ERROR` and the exception event attached.

#### Scenario: A registered message handler is invoked under a span
- **WHEN** a test handler runs to completion via `receiver.handlePayload(...)`
- **THEN** the exporter records exactly one `whatsapp.webhook.dispatch` span per handler invocation
- **AND** the span's `attributes["whatsapp.event.kind"] === "message"`

#### Scenario: A throwing handler records ERROR status on its span
- **WHEN** a registered `message` handler throws
- **THEN** the dispatch span for that invocation has `status.code === SpanStatusCode.ERROR`
- **AND** the span includes an `exception` event whose attribute `exception.message` matches the thrown error

### Requirement: Redis and Postgres storage adapters

The package SHALL export `createRedisStorage(client, options?)` from `@dojocoding/whatsapp/storage/redis` and `createPostgresStorage(client, options?)` from `@dojocoding/whatsapp/storage/postgres`. Both factories SHALL return objects that implement the `Storage` interface (`get`, `set`, `setIfAbsent`, `delete`) with TTL semantics equivalent to `InMemoryStorage`.

Both factories SHALL accept a pre-constructed client object. The adapters SHALL NOT import `ioredis` or `pg` directly — both are declared as optional peer dependencies and referenced via minimal structural interfaces (`RedisLike`, `PgLike`) so consumers may pass any compatible client (production drivers or test fakes).

The Postgres adapter SHALL additionally export `POSTGRES_STORAGE_SCHEMA: string` containing the `CREATE TABLE` and index DDL the consumer runs via their own migration tool.

Both adapters SHALL accept an optional `keyPrefix` (default `"whatsapp:"`) so multiple consumers may share one backend without colliding.

#### Scenario: RedisStorage round-trips a value with TTL

- **WHEN** `createRedisStorage(client).set("k", 42, 1_000)` is called against an ioredis-compatible client and the consumer then calls `get<number>("k")`
- **THEN** `get` resolves to `42`
- **AND** waiting 1_001 ms before the next `get` yields `undefined` (Redis-enforced TTL expiry)

#### Scenario: RedisStorage setIfAbsent uses SET NX

- **WHEN** the same key is set twice via `setIfAbsent`
- **THEN** the first call returns `true`
- **AND** the second call (while the first is unexpired) returns `false`
- **AND** the stored value remains the first one

#### Scenario: PostgresStorage filters expired rows on get

- **WHEN** `createPostgresStorage(client).set("k", "v", 100)` is called and the consumer waits 101 ms (or advances `now()` past the row's `expires_at`) before calling `get<string>("k")`
- **THEN** `get` resolves to `undefined`
- **AND** the row may still exist in the table (lazy eviction); a separate `DELETE WHERE expires_at < now()` job is a consumer concern

#### Scenario: PostgresStorage setIfAbsent succeeds when the existing row is expired

- **WHEN** an expired row exists for `"k"` and `setIfAbsent("k", "new", 60_000)` is called
- **THEN** the call returns `true`
- **AND** subsequent `get<string>("k")` resolves to `"new"`

#### Scenario: WebhookDeduper produces identical behaviour across storage backends

- **WHEN** the same `wamid` is processed by a `WebhookReceiver` configured with `InMemoryStorage`, `createRedisStorage(client)`, or `createPostgresStorage(client)`
- **THEN** all three configurations dedupe identically — the second processing attempt finds the existing entry and skips dispatch
- **AND** the registered handler is invoked exactly once across each backend

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

### Requirement: Status events surface Meta's pricing envelope

For every entry in `entry[i].changes[i].value.statuses[i]` the parser SHALL emit a `StatusEvent` and, **when present in the payload and of the expected primitive type**, lift the following fields verbatim:

- `pricing.category` → `pricingCategory: string`
- `pricing.type` → `pricingType: string` (Meta values: `regular`, `free_customer_service`, `free_entry_point`)
- `pricing.pricing_model` → `pricingModel: string` (Meta values: `PMP`, `CBP`)
- `pricing.billable` → `billable: boolean`
- `conversation.id` → `conversationId: string`

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

