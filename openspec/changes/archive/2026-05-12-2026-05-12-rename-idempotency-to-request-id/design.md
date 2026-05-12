# Design — Rename idempotency-key to request-id

## Context

The header `X-Dojo-Idempotency-Key` exists on every outbound
Graph API request. Its declared purpose (from the JSDoc on
`RequestOptions.idempotencyKey`):

> "Stable identifier for this logical request, reused across
>  retry attempts of that call. Sent as `X-Dojo-Idempotency-Key`."

Meta does not consult this header. The Graph API has no
documented idempotency mechanism for `/{phone_number_id}/messages`
beyond Meta's own internal retry handling. We tested — sending
two `POST /messages` with the same `X-Dojo-Idempotency-Key`
produces two WhatsApp messages.

The "idempotency" naming is therefore at best misleading and at
worst dangerous: a consumer who reads the docs and trusts the
header would believe their retry loop is safe, when it isn't.

The header has one genuine value: **request correlation**. When
a customer has a 500 error and gives us the `X-Request-Id`,
we can find the exact OTel span. That's worth keeping.

So we rename — and the v0.x → v1.0 window is the right moment.

## Goals

- Remove the false "idempotency" claim from the surface.
- Preserve the correlation use case (OTel span, header on
  outbound requests).
- Match an industry-standard header name (`X-Request-Id`).
- Single clean rename; no compatibility shim.

## Non-Goals

- **Real outbound deduplication.** That's post-1.0 work and
  requires a `Storage`-backed cache keyed on
  `(phoneNumberId, recipient, payloadHash, ttl)`. The current
  header is incapable of providing dedup; renaming it doesn't
  change that. The Phase B backlog tracks it separately.
- **Per-request ID propagation across retries.** The current
  code already does this — same UUID for all retry attempts of
  one logical call. Behaviour unchanged; only the names change.

## Decisions

### 1. Why a hard rename, no shim

Two approaches considered:
- (a) Rename + keep an `idempotencyKey` alias for one minor
  cycle, log a deprecation warning.
- (b) Hard rename, fail at compile time, mechanical migration.

Picked (b). Reasons:
- Pre-1.0 minor break is explicitly permitted by `CONTRIBUTING.md`.
- The header was never an honoured contract — calling it
  "idempotency" was wrong. Keeping the wrong name for one more
  cycle perpetuates the misleading claim.
- TypeScript compile error is louder and faster than a runtime
  warning. Consumers find every callsite in one `tsc` run.
- Migration is one `s/idempotencyKey/requestId/g` per file.

### 2. Header name: `X-Request-Id`

The header rename targets `X-Request-Id`, which is:
- The de-facto standard request-correlation header (used by
  AWS, Cloudflare, GitHub, Stripe, etc.).
- Carried by most ALB / load balancer products by default.
- Already understood by every observability stack.

Considered and rejected: `X-Dojo-Request-Id`. The `X-Dojo-`
prefix advertises us in every outbound request to Meta; that's
unhelpful. `X-Request-Id` is plain and conventional.

### 3. Span attribute name: `whatsapp.request.id`

The OTel attribute follows the existing `whatsapp.*` prefix
convention. The previous `whatsapp.idempotency_key` is
removed; downstream Honeycomb / Sentry / etc. dashboards
filtering on that attribute name must update their queries.

The dashboard-breaking blast radius is small — `whatsapp.idempotency_key`
is mentioned exactly once in the SDK source (transport.ts:107).
No public docs use it.

### 4. Option name: `requestId`, not `correlationId`

Considered names:
- `requestId` (picked)
- `correlationId`
- `traceId`
- `id`

`requestId` matches the header. `correlationId` is OK but
slightly fuzzier — a "correlation" can span requests, while
`requestId` is per-call. `traceId` collides with OTel's own
`traceId` semantics. `id` is too generic.

### 5. Behaviour preserved

- Per-call UUID generation when `requestId` is omitted.
- Same UUID reused across retry attempts of one logical call.
- Same propagation to the OTel span (under the new attribute
  name).
- Same outbound header on every request.

The only changes are names. No timing change, no retry change,
no transport change.

### 6. MIGRATION.md framing

The rename gets its own subsection under "SDK: 0.8.x → 1.0.0":

```diff
- await client.sendText({ to, body }, { idempotencyKey: myId });
+ await client.sendText({ to, body }, { requestId: myId });
```

```diff
- // OTel span attribute
- whatsapp.idempotency_key
+ whatsapp.request.id
```

```diff
- // Outbound HTTP header
- X-Dojo-Idempotency-Key: <uuid>
+ X-Request-Id: <uuid>
```

Plus a NOTE: the rename clarifies that the SDK does not
provide outbound idempotency. Real dedup is on the Phase B
roadmap (`outbound-deduper` capability).
