# Change proposal — Rename `X-Dojo-Idempotency-Key` → `X-Request-Id`; drop the dedup claim

## Why

The SDK's outbound HTTP transport
(`packages/whatsapp-sdk/src/client/transport.ts:55`) sets a
header `X-Dojo-Idempotency-Key` with a per-call UUID. The docs
(`docs/architecture.md`) admit the truth:

> "client-side correlation only; Meta does not honor it."

Meta's Graph API does not consult a per-request idempotency
header. Two `POST /messages` calls with the same
`X-Dojo-Idempotency-Key` produce two real WhatsApp messages.
**The header creates a false-positive feeling** — readers see
"idempotency key" and assume Meta will deduplicate. They won't.

This is the v0.x → v1.0 cleanup window. The right v1 surface is:

- Drop the "idempotency" naming — it doesn't deliver
  idempotency.
- Keep a per-call UUID for **request correlation** (OTel spans,
  consumer-side log correlation, server error reports). Rename
  the header to the industry-standard `X-Request-Id`.
- Rename the public option to `requestId` (not
  `idempotencyKey`).
- Drop the OTel span attribute `whatsapp.idempotency_key`
  alongside; replace with `whatsapp.request.id`.

Real outbound deduplication is post-1.0 — see the Phase B
backlog. That requires a `Storage`-backed cache and a deliberate
design pass; not a per-request header.

## What Changes

### Public API change (BREAKING under semver, pre-1.0)

- **RENAMED option:** `RequestOptions.idempotencyKey` →
  `RequestOptions.requestId` (string, optional, defaults to a
  generated UUID v4).
- **RENAMED outbound header:** `X-Dojo-Idempotency-Key` →
  `X-Request-Id`.
- **RENAMED OTel span attribute:** `whatsapp.idempotency_key`
  → `whatsapp.request.id`.

### Doc changes

- `docs/architecture.md` § "Outbound idempotency" — remove the
  "client-side correlation only" caveat; rewrite as "Outbound
  request correlation" naming the new header + attribute and
  pointing at the Phase B outbound-dedup backlog for genuine
  deduplication.
- `docs/sdk/client.md` § `RequestOptions` — document `requestId`
  with its purpose (correlation, NOT dedup).
- `MIGRATION.md` § "SDK: 0.8.x → 1.0.0" — gain a one-line
  migration entry naming the rename.

### Removed surface

The pre-existing `IDEMPOTENCY_HEADER` and `idempotencyKey`
identifiers are removed entirely. No compatibility shim — the
header was never an honoured contract.

## Impact

- **cloud-api-client capability:** 1× MODIFIED requirement
  (the request-options shape), 1× REMOVED requirement (the
  false "idempotency" claim).
- **observability capability:** 1× MODIFIED requirement (span
  attribute rename).
- **Release impact:** `sdk-v0.9.0` (minor, BREAKING but pre-1.0
  — `CONTRIBUTING.md` § Releases explicitly permits pre-1.0
  minors to break).
- **Stability after `sdk-v1.0.0`:** the new `requestId` /
  `X-Request-Id` / `whatsapp.request.id` surface is locked
  under standard semver.
- **Breaking?** Yes — any consumer reading `req.idempotencyKey`
  in their custom retry hook breaks at compile time. Migration
  is mechanical (`s/idempotencyKey/requestId/g`).
