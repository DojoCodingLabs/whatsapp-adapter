# Change proposal — Expose `referral` / `ctwa_clid` on `MessageEvent`

## Why

Click-to-WhatsApp (CTWA) ads attach a tracking payload to the
**first** inbound message a user sends after clicking the ad.
The payload lives under `messages[i].referral` in Meta's
webhook payload and carries (among other fields) `ctwa_clid` —
the click identifier Meta CAPI matches against to attribute
the conversation back to the originating ad.

The SDK's parser **silently discards this field**. Confirmed:
`grep -rn 'ctwa' packages/whatsapp-sdk/src/` returns empty.
Consumers building CTWA-attributed funnels (Site2Print's ad
campaign routing per their `CLAUDE.md`) currently re-parse the
raw payload themselves, defeating the parser's purpose.

The fix is one new optional field on `MessageEvent` (and
helpers) so the parsed event surface matches the Meta payload's
documented shape.

## What Changes

### Public surface addition (non-breaking)

- **NEW** `MessageEvent.referral?: WhatsAppReferral` — populated
  when `messages[i].referral` is present in the payload.
- **NEW type** `WhatsAppReferral`:
  ```ts
  interface WhatsAppReferral {
    /** Click-to-WhatsApp click ID used by Meta CAPI for attribution. */
    ctwa_clid?: string;
    /** Source URL the user came from (ad / post link). */
    source_url?: string;
    /** "ad" | "post" — the source type. */
    source_type?: string;
    /** Meta-side source identifier (ad ID, post ID, etc.). */
    source_id?: string;
    /** Headline shown above the ad. */
    headline?: string;
    /** Body text of the ad/post. */
    body?: string;
    /** Media type of the ad ("image" | "video" | "text"). */
    media_type?: string;
    /** URL of the ad's media asset (image or video). */
    media_url?: string;
    /** URL of the thumbnail (video only). */
    thumbnail_url?: string;
    /** Welcome message ID set on the ad (when present). */
    welcome_message?: { message_id?: string };
  }
  ```

### Parser change

The webhook parser (`packages/whatsapp-sdk/src/webhooks/parser.ts`)
SHALL preserve the `referral` object verbatim from each
`messages[i]` entry onto the parsed `MessageEvent`. Field
shapes follow Meta's documented payload — strings, optional,
no normalisation.

### Fixture

A new fixture
`packages/whatsapp-sdk/test/__fixtures__/webhooks/message-with-ctwa-referral.json`
captures a real CTWA-tagged inbound payload (sanitised) so
the parser test can assert byte-identical pass-through.

### Docs

- `docs/sdk/webhooks.md` § "Inbound message events" gains a
  "Referral / CTWA" subsection naming the field, the use case,
  and a tiny snippet for handing the `ctwa_clid` off to Meta
  CAPI.

## Impact

- **webhook-receiver capability:** 1× MODIFIED requirement on
  the message parser's emitted surface.
- **Release impact:** `sdk-v0.9.0` (minor, additive — bundled
  with A2 and A4).
- **Stability:** part of the v1 commitment; field shape locks
  at `sdk-v1.0.0`.
- **Breaking?** No. Adding an optional field to a parsed event
  is non-breaking.
