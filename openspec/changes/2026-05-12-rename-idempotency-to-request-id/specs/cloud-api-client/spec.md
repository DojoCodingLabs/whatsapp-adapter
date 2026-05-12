## MODIFIED Requirements

### Requirement: Outbound request correlation

The SDK's HTTP transport SHALL attach a stable per-call
identifier to every outbound Graph API request for correlation
purposes (OTel spans, consumer-side log correlation, support
escalation).

The transport SHALL accept an optional `requestId: string` on
`RequestOptions`. When omitted, the transport SHALL generate a
UUID v4 per logical call. When supplied, the consumer-provided
value SHALL be used verbatim.

The identifier SHALL be:

- Sent as the HTTP header `X-Request-Id: <value>` on every
  outbound request.
- Recorded as the OTel span attribute `whatsapp.request.id` on
  every `whatsapp.request` span.
- Reused across retry attempts of one logical call. The retry
  helper SHALL NOT generate a new id between attempts.

The SDK SHALL NOT advertise outbound idempotency or
deduplication. Meta's Graph API does not consult `X-Request-Id`
for deduplication; consumers requiring real outbound dedup must
wait for the v2 `outbound-deduper` capability.

#### Scenario: Generated `requestId` is reused across retry attempts

- **GIVEN** a `WhatsAppClient.sendText(...)` call with no explicit `requestId`
- **WHEN** the first attempt fails with a transient `5xx` and the retry helper retries
- **THEN** the second attempt's `X-Request-Id` header SHALL match the first's
- **AND** the OTel span SHALL record the same `whatsapp.request.id`

#### Scenario: Consumer-supplied `requestId` is preserved verbatim

- **GIVEN** a `WhatsAppClient.sendText(input, { requestId: "abc-123" })` call
- **WHEN** the request is issued
- **THEN** the outbound HTTP header SHALL be `X-Request-Id: abc-123`
- **AND** the OTel span attribute SHALL be `whatsapp.request.id = "abc-123"`

## REMOVED Requirements

### Requirement: ~~Outbound idempotency via `X-Dojo-Idempotency-Key`~~

**Reason:** The header `X-Dojo-Idempotency-Key` was sent on
every request but Meta does not consult it. The "idempotency"
naming created a false-positive feeling for consumers who
assumed retries were deduplicated server-side. The capability
is replaced by request correlation under a renamed surface
(`requestId` / `X-Request-Id` / `whatsapp.request.id`). Real
outbound dedup is deferred to a v2 `outbound-deduper`
capability.

**Migration:** consumers reading `req.idempotencyKey` rename
to `req.requestId`; consumers querying OTel spans on
`whatsapp.idempotency_key` rename to `whatsapp.request.id`;
consumers asserting the outbound header `X-Dojo-Idempotency-Key`
rename to `X-Request-Id`. No behavioural change beyond the
renames.
