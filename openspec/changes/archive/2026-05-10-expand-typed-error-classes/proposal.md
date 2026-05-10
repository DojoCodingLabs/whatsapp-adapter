## Why

Today the SDK collapses every Meta error code outside the rate-limit set, the window-closed code, and the template `132xxx` range into `WhatsAppError("UNKNOWN", …)`. Common failures that consumers routinely branch on — auth (`190`), permission (`200`, `210`, `230`), and capability (`100`) — are indistinguishable in `catch` blocks without parsing `err.message` or stashing `err.cause`.

Three new typed subclasses cover the cases consumers actually want to act on differently:

- **Authentication** (`190`, plus subcodes `463`, `467`, `492` for expired/revoked tokens) — should trigger token rotation, not retry.
- **Permission** (`200`, `210`, `230`, `294`, `299`) — typically a Business Manager scope or BSP-assignment problem; surface to ops, not the message-send pipeline.
- **Capability** (`100` "Invalid parameter") — almost always a request-shape bug; surface during development, drop on the floor in prod.

Adding them as `WhatsAppError` subclasses keeps `instanceof WhatsAppError` checks intact (existing `catch` blocks that match the base class continue to work) and gives discriminator-code branching on the new codes.

## What Changes

- **MODIFIED** `src/types/errors.ts`:
  - Widen the `WhatsAppErrorCode` discriminator union with `"AUTHENTICATION" | "PERMISSION" | "CAPABILITY"`.
  - Add three new subclasses extending `WhatsAppError`:
    - `AuthenticationError` (`code: "AUTHENTICATION"`, optional `metaCode` and `subcode`).
    - `PermissionError` (`code: "PERMISSION"`, optional `metaCode`).
    - `CapabilityError` (`code: "CAPABILITY"`, optional `metaCode`).
  - All three set up the prototype chain via `Object.setPrototypeOf` so `instanceof` works across module boundaries.
- **MODIFIED** `src/client/errors.ts` `mapMetaError`:
  - Map `190` → `AuthenticationError`, carrying `error_subcode` when present.
  - Map `200`, `210`, `230`, `294`, `299` → `PermissionError`.
  - Map `100` → `CapabilityError`.
  - Anything else still falls through to `WhatsAppError("UNKNOWN", …)`.
  - The retryable set is unchanged — none of the new codes are retryable.
- **MODIFIED** `src/index.ts` re-exports the three new classes.
- **MODIFIED** `openspec/specs/cloud-api-client/spec.md`: the "Meta error-code mapper" requirement extends with the three new mappings and accompanying scenarios.
- **NEW** unit tests in `test/unit/types/errors.test.ts` covering the three new classes' discriminators / `instanceof` chain.
- **NEW** unit tests in `test/unit/client/errors.test.ts` covering the three new mappings.

## Capabilities

### Modified Capabilities

- `cloud-api-client`: `mapMetaError` now produces three additional typed-error subclasses for codes `190`, `200`/`210`/`230`/`294`/`299`, and `100`. The `UNKNOWN` fallback remains for everything else.

## Non-goals

- **No exhaustive Meta error coverage.** This change adds the three categories consumers branch on. Promoting more codes to typed classes (recipient-blocked, template-paused, throughput-exceeded, etc.) lands as separate changes when consumer demand is concrete.
- **No retry semantics change.** None of the three new codes are retryable. Existing retry behaviour is untouched.
- **No re-classification of existing codes.** Rate-limit, window-closed, and `132xxx` template mappings stay as they are.
- **No webhook-event-error mapping.** This change covers Graph API HTTP errors only; status-update `errors[]` arrays inside webhook events remain raw.

## Impact

- **Code:** `src/types/errors.ts` and `src/client/errors.ts` get extensions; net-new ~80 LOC plus tests.
- **Public API:** three new classes added to the surface. `WhatsAppErrorCode` widens (additive — non-breaking for consumers that check `instanceof WhatsAppError` or branch on a known subset of codes).
- **Existing consumers:** non-breaking. Any `if (err instanceof WhatsAppError && err.code === "UNKNOWN")` check that previously matched a `190` / `200` / `100` will now miss it (because the SDK throws a more specific class). That's the intended behaviour and is called out in `docs/compliance.md`.
- **Risk:** low. The mapper is the only call-site that produces these errors; tests pin the new mappings.
