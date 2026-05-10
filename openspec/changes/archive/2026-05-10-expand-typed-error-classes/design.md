## Approach

Add three new `WhatsAppError` subclasses (`AuthenticationError`, `PermissionError`, `CapabilityError`) and extend `mapMetaError` with code-set membership checks. Keep the order of checks in `mapMetaError` deterministic so the most-specific class wins.

The class hierarchy stays flat — no `AuthOrPermissionError` superclass — because `instanceof WhatsAppError` is already the catch-all and adding intermediate classes complicates discriminated unions on `code`.

## Domain rules satisfied

From `openspec/config.yaml`:

- "Errors are typed classes extending `WhatsAppError`. No throwing strings. No `any` in error payloads." — preserved; the new classes follow the same pattern as the existing six.
- "Never silently catch and swallow errors. Surface or wrap with context." — `mapMetaError` continues to surface the Meta message and code on every typed class.

## Code selection rationale

Authentication / permission / capability codes documented by Meta:

- `100` "Invalid parameter" / "API Unknown" — capability errors. Calling code shape is wrong.
- `190` "Invalid OAuth access token" — authentication. Subcodes `463`, `467`, `492` indicate expired / revoked / changed tokens.
- `200`, `210`, `230` — Permission errors (general / phone-level / unsupported-permission).
- `294` "Permission for this action is required" — Permission family.
- `299` "Permission denied for this action" — Permission family.

Codes deliberately NOT promoted in this change:

- `131000`, `131005`, `131008`, `131009` (recipient/parameter problems): these are message-validity, not auth/permission/capability — adding a fourth class for them adds churn without clear caller benefit. They stay `UNKNOWN`.
- `131031`, `131045` (recipient-blocked): could become a `RecipientError` later; deferred until consumers ask.
- Throughput / capacity codes (`133xxx`): not currently observed in front-desk traffic; would belong under rate-limiting if/when they are.

## Alternatives considered

- **Single `MetaError` class with a discriminator field.** Rejected. We already have a discriminator (`code: WhatsAppErrorCode`) on the base class — duplicating it as a property on a single class undoes the typed-error-hierarchy invariant.
- **Throw the raw Meta envelope as a typed class.** Rejected. The raw envelope is included via `WhatsAppError.message` and (when constructed via mapper) optionally `cause`. A "typed envelope" class shifts complexity onto every consumer.
- **Map every documented Meta code into its own class.** Rejected as scope creep. Three new classes cover the cases consumers actually branch on; further additions are cheap when motivated by real usage.

## Migration

Existing `catch` blocks that match `WhatsAppError` keep working unchanged. The only behavioural change for existing consumers is that `err.code === "UNKNOWN"` no longer matches codes `190`, `200`, `210`, `230`, `294`, `299`, `100` — those throw `AuthenticationError`, `PermissionError`, or `CapabilityError` instead. Any consumer that previously matched on `err.message.includes("Invalid OAuth")` should switch to `err instanceof AuthenticationError`.
