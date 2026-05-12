# Design — Expose `referral` on parsed message events

## Context

Meta's webhook payload for an inbound message can include a
`referral` object on the first message a user sends after
clicking a CTWA ad. The payload shape (per Meta's documented
schema, May 2026):

```json
{
  "messages": [
    {
      "from": "...",
      "id": "wamid....",
      "timestamp": "...",
      "type": "text",
      "text": { "body": "Hi" },
      "referral": {
        "source_url": "https://fb.me/...",
        "source_type": "ad",
        "source_id": "123456789",
        "headline": "Try Site2Print today",
        "body": "Order custom prints in minutes",
        "media_type": "image",
        "media_url": "https://...",
        "thumbnail_url": "https://...",
        "ctwa_clid": "ARZxq..."
      }
    }
  ]
}
```

The `ctwa_clid` is the one Meta CAPI checks against to credit
the conversation back to the originating ad. Without surfacing
it, downstream consumers can't do ad attribution at all without
bypassing the SDK and re-parsing the raw bytes.

## Goals

- Surface every documented field of the `referral` object on
  the parsed `MessageEvent`, optionally.
- Keep the shape close to Meta's payload to minimise translation
  surface (consumers can `Object.assign(capiPayload, e.referral)`
  cleanly).
- Don't lose forward compatibility: if Meta adds a new field
  to `referral`, our parser shouldn't drop it.

## Non-Goals

- **CAPI integration.** The SDK isn't a Meta CAPI client.
  Consumers do their own CAPI POSTs.
- **Persistence.** The SDK doesn't store `ctwa_clid`. Consumers
  persist it in their own DB (typically alongside the
  recipient phone number, with an expiry — `ctwa_clid` is only
  meaningful for the conversion window).
- **Multiple-message attribution.** Per Meta's spec, only the
  **first** message after the click carries `referral`.
  Subsequent messages in the same conversation don't.
  Consumers tracking attribution across a multi-message flow
  cache the click ID themselves.

## Decisions

### 1. Field naming: `referral`, not `ctwa`

The wider object is called `referral` in Meta's payload. We
preserve that name — consumers already know what to look up in
Meta's docs. `ctwa_clid` is the field inside `referral`, not the
field name on the event.

### 2. Snake_case vs camelCase

The SDK's existing webhook event shapes use snake_case where
they mirror Meta's payload directly (e.g. `phone_number_id`,
`wabaId` — yes, the SDK is inconsistent today, hangover of an
earlier refactor). Picking the simpler invariant: the `referral`
object's fields stay snake_case to match Meta's payload
verbatim. Translates to "1:1 with Meta docs."

### 3. Forward-compat: pass-through unknown keys

The parser uses a permissive shape — it preserves every key on
`messages[i].referral` even if it isn't in our typed
`WhatsAppReferral` interface. The TypeScript type narrows the
documented fields, but the runtime object can carry more. This
costs nothing and saves consumers from re-parsing the raw body
when Meta adds a new field.

The fixture test asserts the documented fields are preserved
byte-identically; it doesn't assert "only these fields exist."

### 4. Empty object handling

If Meta sends `referral: {}` (empty), the parser SHALL still
populate `event.referral = {}`. This is rare but observed —
preserving it lets consumers distinguish "no referral" from
"referral present but Meta omitted details."

If `referral` is absent from the message payload, `event.referral`
is `undefined`.

### 5. No new error class

`referral` parsing failures are not actionable — Meta's spec is
permissive, and an unrecognised field shape would be a Meta
change, not our consumer's problem. The parser SHALL pass
through whatever shape it receives without throwing. The
existing `parseWebhookPayload` error contract is unchanged.

### 6. Test strategy

- Fixture for the happy path (full referral object).
- Fixture for `referral: {}` (empty object).
- Fixture for a message without `referral` (asserts
  `event.referral === undefined`).
- Property test (optional): generate random object shapes
  under `referral`; the parser SHALL not throw.

### 7. CHANGELOG framing

This ships as a non-breaking addition. The CHANGELOG entry
calls out the new field, the use case (CTWA attribution), and
points at the new doc section.
