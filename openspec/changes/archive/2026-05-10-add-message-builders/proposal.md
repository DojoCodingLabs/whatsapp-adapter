## Why

With Phase 1 in place, `WhatsAppClient.request<T>()` can talk to Meta safely, but consumers still have to hand-craft the wire JSON for every message type (and get the discriminator field right, the 1-indexed template variables right, the `context.message_id` reply shape right…). This change introduces the `message-builders` capability — typed discriminated-union builders for every send-able message type plus a `sendMessage()` helper and convenience methods on `WhatsAppClient` — so callers write `client.sendText({ to, body: "hi" })` instead of stitching together six fields by hand.

## What Changes

- **NEW** capability `message-builders`. Discriminated-union TypeScript types and zod schemas for every WhatsApp Cloud API send-able message body:
  - `text` (with optional `preview_url`)
  - media: `image`, `video`, `audio`, `document`, `sticker` (each via `id` OR `link`, with optional `caption`/`filename`)
  - `location` (lat, lng, optional name + address)
  - `contacts` (one or more `Contact` objects with names/phones/emails/etc.)
  - `interactive`: `button`, `list`, `cta_url`
  - `template` (name + language + components — full validator including 1-indexed `{{N}}` placeholder counting)
  - `reaction` (message id + emoji or empty string to clear)
  - reply variant of any of the above (top-level `context.message_id`)
- **NEW** builder helper functions under `src/messages/builders.ts`: one per type, each returns the validated wire payload. They are pure (no I/O).
- **NEW** `sendMessage(client, payload)` helper under `src/messages/send.ts`: posts the payload to `/{phoneNumberId}/messages` via `client.request()` and returns the parsed `MessageSendResponse` (`{ messaging_product, contacts, messages: [{ id }] }`).
- **NEW** convenience methods on `WhatsAppClient`: `sendText`, `sendImage`, `sendVideo`, `sendAudio`, `sendDocument`, `sendSticker`, `sendLocation`, `sendContacts`, `sendInteractive`, `sendTemplate`, `sendReaction`, `sendReply` (sends a reply-shaped payload to a prior `wamid`).
- **NEW** runtime dependency `zod@^3` (moved from devDep to runtime). Consumers will sometimes import the schemas directly (e.g., to validate user-provided template parameters).
- **NEW** fixtures under `test/__fixtures__/messages/` — golden wire-JSON snapshots for every builder, easy to copy-paste against Meta docs.
- **NEW** fast-check property tests for builders in `test/unit/messages/properties.test.ts`.

## Capabilities

### New Capabilities
- `message-builders`: typed builders + per-type send convenience methods.

### Modified Capabilities
None — Phase 2 does not change `cloud-api-client` or any other existing spec.

## Non-goals

- **Not `interactive.flow`** beyond a stub. Flows have a substantial server-side schema (cards, screens, action handlers); shipping them properly belongs in a later change. Phase 2's `interactive` covers `button`, `list`, `cta_url` only; passing `type: "flow"` is rejected by the validator with a clear error.
- **No template management**: Phase 5 (`add-template-management`) owns `listTemplates`/`getTemplate` and parameter-count cross-validation against approved template definitions. Phase 2 only owns the wire shape of an outgoing template *send*.
- **No 24-h-window enforcement at send time**: Phase 4 (`add-window-tracker`) wires that in. Phase 2 sends regardless; Meta will reject with `131026` and `mapMetaError` will surface a `WindowClosedError`.
- **No media upload helpers**: `sendImage({ link })` works today (passes a URL through to Meta); `sendImage({ id })` requires a media id from `POST /{phone-number-id}/media`, which is a separate, deferred change.
- **No automatic chunking/queuing**: each `send*()` is one HTTP call.

## Impact

- **Code**: `src/messages/{types.ts,schemas.ts,builders.ts,send.ts,index.ts}`. `src/client/whatsapp-client.ts` gains 12 thin convenience methods. `src/index.ts` re-exports the message types and builders.
- **APIs**: 12 new public methods on `WhatsAppClient`. Discriminated-union message types and builders become public exports.
- **Dependencies**: `zod@^3` moved/added as a runtime dependency. `fast-check@^3` added as a devDep. No new HTTP deps.
- **Systems**: contract tests stay msw-driven; fixture-based serialization tests assert exact wire JSON.
