# Change proposal — inbound identity (BSUID / usernames), typed accessors, value-level errors

Affected capabilities: `webhook-receiver`, `agent-bridge`.

## Why

The 2026-11-26 webhook audit (`matrix-webhooks.md` rows 3–7, 11, 15,
17, 19, 22, 24–25, 27, 29, 30, 32–33, 35–37, 42, 46; `matrix-platform.md`
rows 26–27) found that the parser predates Meta's business-scoped user
id (BSUID) rollout:

- Users who adopt a username and do not share their phone number arrive
  without `messages[].from`. The SDK set `from: ""` and exposed no
  `from_user_id`, so every such user collapsed onto one empty key in
  consumer state, the agent bridge and the window tracker.
- `value.contacts[]` (profile name, username, BSUID, identity hash) was
  unreachable on message and status events.
- BSUID rotations (`system` `user_changed_user_id`) had no typed
  accessor, although Meta says this is the only way to rejoin identity.
- A `messages` change carrying only `value.errors` produced zero events.
- `user_preferences` dedupe keyed on `waId`; two username-only users
  opting out in the same second collided and the second opt-out was
  dropped (compliance risk).
- Statuses lacked `recipient_user_id`, `biz_opaque_callback_data`,
  `pricing.subtype`; pricing JSDoc described pre-Oct-1-2026 semantics.
- Interactive `product`, `edit`, `revoke` collapsed to `unsupported`;
  the CTWA referral type named `media_url` / `welcome_message.message_id`
  instead of the documented `image_url` / `video_url` /
  `welcome_message.text`.
- Dedupe TTL was 24 h while Meta redelivers for up to 7 days.
- The `whatsapp.event.id` span attribute carried the raw wamid.

## What Changes

- `MessageEvent`: `fromUserId?`, `fromParentUserId?`, `contact?`,
  `groupId?`, `errors?`. `from` stays `string` (documented as possibly
  `""`); new `messageSenderKey(e)` returns phone, else BSUID.
- Pure accessors: `messageText`, `messageReplyId`, `messageMedia`,
  `messageReferral`, `messageIdentityChange`, `messageSenderKey`.
- `IncomingMessageKind` + `interactive_product`, `edit`, `revoke`;
  `request_welcome` marked deprecated (still parsed).
- New `WebhookErrorEvent` (`kind: "webhook_error"`) for `value.errors`.
- `StatusEvent`: `recipientUserId?`, `recipientParentUserId?`,
  `recipientType?`, `recipientParticipantId?`,
  `recipientIdentityKeyHash?`, `bizOpaqueCallbackData?`,
  `pricingSubtype?`, `contact?`; typed `errors` (`error_data.details`,
  `href`).
- `UserPreferencesEvent`: `userId?`, `parentUserId?`; dedupe identity
  falls back to `bsuid:<userId>` when `waId` is empty.
- `WEBHOOK_DEDUPE_TTL_MS` = 7 days.
- `whatsapp.event.id` span attribute hashed with the receiver salt.
- Agent bridge keys `conversationId` / window tracker on
  `messageSenderKey(event)`; `AgentTask.fromUserId?`.

## Non-goals (deferred)

- `context.forwarded` / `referred_product` (row 6), `contacts` message
  `origin` (row 15), `conversation_context` (row 28): reachable via raw
  `body`; no consumer need yet.
- Changing `from` to optional or making `waId` optional: rejected as
  a type break for every consumer (see design.md).
- Outbound sends to a BSUID (`recipient`): owned by the outbound change.

## Impact

- `webhook-receiver`: 6 MODIFIED, 3 ADDED requirements.
- `agent-bridge`: 1 MODIFIED requirement.
- Mostly additive. Breaking for exhaustive switches over the widened
  unions and for observers matching the raw wamid on spans (CHANGELOG
  `### Breaking`).
