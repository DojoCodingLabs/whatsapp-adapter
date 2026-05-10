## ADDED Requirements

### Requirement: Timing-safe HMAC-SHA256 signature verification
The package SHALL export `verifySignature({ rawBody, signatureHeader, appSecret })` that returns `true` if and only if the HMAC-SHA256 of the **raw bytes** of `rawBody` keyed with `appSecret` matches the hex value in `signatureHeader`. Comparison SHALL be timing-safe (`crypto.timingSafeEqual`). The `sha256=` prefix SHALL be tolerated and stripped. `rawBody` SHALL accept `Buffer | Uint8Array | string`.

#### Scenario: Valid signature returns true
- **WHEN** `signatureHeader === "sha256=" + hmacSha256Hex(appSecret, rawBody)`
- **THEN** `verifySignature(...)` returns `true`

#### Scenario: Tampered body returns false (without throwing)
- **WHEN** the rawBody is altered by one byte after the signature was computed
- **THEN** `verifySignature(...)` returns `false`

#### Scenario: Mismatched `appSecret` returns false
- **WHEN** the signature was computed with one secret but verified with another
- **THEN** `verifySignature(...)` returns `false`

#### Scenario: Missing or malformed header returns false
- **WHEN** `signatureHeader` is `undefined`, `""`, `"sha256="`, `"not-hex"`, or hex of the wrong length
- **THEN** `verifySignature(...)` returns `false` (no throw)

### Requirement: Webhook verify-token handshake
The package SHALL export `verifyHandshake({ mode, verifyToken, challenge, expectedToken })` that returns the `challenge` value when `mode === "subscribe"` AND `verifyToken === expectedToken` (constant-time compare). Otherwise returns `null`.

#### Scenario: Valid handshake echoes the challenge
- **WHEN** `verifyHandshake({ mode: "subscribe", verifyToken: "abc", challenge: "1234", expectedToken: "abc" })`
- **THEN** the return value is `"1234"`

#### Scenario: Wrong token returns null
- **WHEN** `verifyHandshake({ mode: "subscribe", verifyToken: "wrong", challenge: "1234", expectedToken: "abc" })`
- **THEN** the return value is `null`

#### Scenario: Wrong mode returns null
- **WHEN** `verifyHandshake({ mode: "unsubscribe", verifyToken: "abc", challenge: "1234", expectedToken: "abc" })`
- **THEN** the return value is `null`

### Requirement: Polymorphic webhook payload parser
The package SHALL export `parseWebhookPayload(body)` that walks Meta's `{ object, entry: [{ id: wabaId, changes: [{ field, value }] }] }` envelope and returns a flat `ReadonlyArray<WhatsAppEvent>`. Recognised `field` values: `messages`, `message_template_status_update`, `message_template_quality_update`, `template_category_update`, `phone_number_quality_update`, `account_alerts`, `account_review_update`. Unrecognised fields produce `{ kind: "unknown", field, value, wabaId }` events. Inbound `messages` events split into per-message events (each entry's `value.messages[]` becomes one event); status updates split per `value.statuses[]`.

#### Scenario: A captured `messages` payload yields one MessageEvent per inbound message
- **WHEN** the payload is a single-entry `whatsapp_business_account` body with `value.messages` of length 2
- **THEN** the result has exactly 2 events, both `{ kind: "message" }`
- **AND** each event carries `wabaId`, `phoneNumberId`, the originating `from`, the `wamid` (`event.id`), and a normalised `timestamp` (ms epoch)

#### Scenario: Status updates split per item in `value.statuses[]`
- **WHEN** the payload's `value.statuses` is `[{ id: "wamid.a", status: "sent" }, { id: "wamid.b", status: "delivered" }]`
- **THEN** the result has 2 `{ kind: "status" }` events with `event.id` `wamid.a` and `wamid.b` respectively

#### Scenario: `message_template_status_update` produces a TemplateStatusEvent
- **WHEN** the payload's `field === "message_template_status_update"` with `value.event === "APPROVED"` and a `message_template_id`
- **THEN** the parser emits one `{ kind: "template_status", templateId, event: "APPROVED" }` event

#### Scenario: Unknown field surfaces as `{ kind: "unknown" }`
- **WHEN** the payload contains `field: "smb_app_state_sync"` (not in the recognised list)
- **THEN** the parser emits one `{ kind: "unknown", field: "smb_app_state_sync", value, wabaId }` event

#### Scenario: Malformed envelope yields an empty array
- **WHEN** the payload is missing `entry` or has non-array `entry`
- **THEN** the parser returns `[]` without throwing

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
The package SHALL export a `WebhookDeduper(storage, ttlMs)` whose `markIfNew(eventKey)` returns `true` when the event was not seen within the TTL window and `false` when it was. The default TTL SHALL be 1 hour. The receiver SHALL skip dispatch for any `message` event whose `wamid` was already seen, and any `status` event whose `id` was already seen with the same `status` value.

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
- `.on(kind, handler)` to register a handler per event kind (`message`, `status`, `template_status`, `template_quality`, `template_category`, `phone_number_quality`, `account_alert`, `account_review`, `unknown`, `error`).
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
