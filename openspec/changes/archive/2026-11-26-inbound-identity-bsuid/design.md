# Design — inbound identity (BSUID / usernames)

## `from`: keep `string`, add `messageSenderKey`

Options considered:

1. `from?: string` — honest, but every consumer that passes `e.from`
   to `sendText({ to })`, `notifyInbound`, a `Map` key etc. stops
   compiling. Every existing `MessageEvent` literal in consumer tests
   still compiles, but reads do not.
2. Keep `from: string`, document that it is `""` when Meta omits it, add
   `fromUserId?` and a pure `messageSenderKey(e)` helper.
3. A required `senderKey` field on the event — breaks every consumer
   that constructs `MessageEvent` literals (tests, mock injections).

Chosen: **2**. It is purely additive at the type level, and "silently
`""`" is addressed by JSDoc on `from`, the docs table and a helper that
never returns `""` when Meta sent any identifier.

`messageSenderKey` is **phone first, BSUID second** (the brief floated
`fromUserId ?? from`). Reasons: Meta now sends `from_user_id` to
everyone, so BSUID-first would silently re-key every existing
conversation, window-tracker entry and CTWA cache on upgrade; and the
window tracker must match the `to` used on outbound sends, which is
still the phone for phone users. Username-only users, who previously
all collapsed onto `""`, get their BSUID. Consumers that want BSUID-
first identity read `e.fromUserId` directly.

`UserPreferencesEvent.waId` follows the same rule (stays `string`,
documented `""`, `userId?` added) for consistency.

## Contact join

`value.contacts[]` is joined per message: `wa_id === from`, else
`user_id === from_user_id`, else — only when the batch holds exactly one
message (or status) — the single contact. We never guess between
several unmatched contacts. `fromUserId` falls back to the joined
contact's `user_id`, and for `system` `user_changed_user_id` (no
`from`, no contacts) to `system.user_id`, so the bridge never keys a
rotation on `""`.

## Value-level errors

A new event kind (`webhook_error`) rather than reusing `unknown`:
`unknown` means "field the SDK does not parse"; these are documented
errors on a known field. Not deduped (no stable id). Emitted alongside
any messages / statuses in the same change.

## Dedupe

- Messages stay on `msg:<wamid>`.
- `user_preferences` identity is `waId` when non-empty (unchanged keys
  for phone users), else `bsuid:<userId>`, else `""` (old behaviour).
- Default TTL 7 days. Cost: one small key per message / status
  transition for a week; documented with the `dedupeTtlMs` escape hatch.

## Span privacy

`whatsapp.event.id` = `hashPhoneNumberId(wamid, redactSalt)` — the same
salted 16-hex helper used for WABA / phone ids, so per-tenant salts keep
working and consumers can still correlate by hashing on their side.
