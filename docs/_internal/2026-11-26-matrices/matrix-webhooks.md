# WhatsApp SDK audit: inbound webhooks

- **SDK:** `packages/whatsapp-sdk @ 177527c` (pins Graph v26.0)
- **Audit date:** 2026-11-26
- **How the docs were fetched:** raw HTML from developers.facebook.com with `?locale=en_US`, converted to text. Every page in the table was fetched on 2026-11-26. The "last updated" dates come from each page's `lastUpdated` stamp.
- **URL prefix:** `W/` stands for `https://developers.facebook.com/documentation/business-messaging/whatsapp/`.
- **Paths:** SDK paths are relative to the SDK root. `P` = `src/webhooks/parser.ts`, `E` = `src/webhooks/events.ts`, `R` = `src/webhooks/receiver.ts`, `S` = `src/webhooks/signature.ts`, `H` = `src/webhooks/handshake.ts`, `A` = `src/adapters/web/index.ts`.
- **Tests:** `test/unit/webhooks/` and `test/__fixtures__/webhooks/`.

Anything marked UNVERIFIED comes from memory or from SDK comments that no current Meta page supports.

## Matrix

| #   | Rule (quoted doc)                                                                                                                                                                                                                                                                                                                                                                                                   | Meta URL (+ last-updated)                                                                      | SDK file:line                                                                  | Test                                                                                | Status               | Note                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Envelope: `"object": "whatsapp_business_account"`, `entry[].id` = "Messaging account ID", `entry[].changes[].field` / `.value`                                                                                                                                                                                                                                                                                      | W/webhooks/reference/messages (Nov 4, 2026)                                                    | P:55-78                                                                        | parser.test.ts "returns [] on a malformed envelope"                                 | OK                   | `entry.time` (present on some fields, e.g. business_username_updates) is ignored. That is harmless.                                                                                                                                                                                                                                                   |
| 2   | `value.metadata.display_phone_number` / `phone_number_id`                                                                                                                                                                                                                                                                                                                                                           | W/webhooks/reference/messages/text (Nov 4, 2026)                                               | P:85-91, 178-179                                                               | parser.test.ts "parses text-inbound"                                                | OK                   |                                                                                                                                                                                                                                                                                                                                                       |
| 3   | "Incoming user messages and individual-message status webhooks (sent, delivered, and read) identify the WhatsApp user by their business-scoped user ID (BSUID)... build your integration to identify users by BSUID. An integration that relies only on phone number fields will not be able to process messages from these users."                                                                                 | W/webhooks/reference/messages (Nov 4, 2026)                                                    | P:163 (`from` only), E:96-130 (no BSUID field)                                 | untested                                                                            | **bug**              | `MessageEvent` has no `fromUserId`. For a user with a username and no shareable phone, `from` is set to `""` (P:163). Consumers keyed on `from` merge every such user into one empty key. `from_user_id` survives only in the untyped `body`.                                                                                                         |
| 4   | `messages[].from` — "New behavior (can be omitted)... Will be omitted if the phone number cannot be included"; `from_user_id` — "New property, set to the user's BSUID"; `from_parent_user_id` — "only if parent BSUIDs enabled"                                                                                                                                                                                    | W/business-scoped-user-ids (Nov 5, 2026)                                                       | P:163                                                                          | untested (no BSUID fixture)                                                         | **missing**          | Add `fromUserId?` and `fromParentUserId?`. Make `from` optional or document it as possibly `""`.                                                                                                                                                                                                                                                      |
| 5   | `value.contacts[]`: `profile.name`, `profile.username` ("only included if user has adopted a username"), `wa_id` ("omitted if user's phone number is unavailable"), `user_id`, `parent_user_id`, `identity_key_hash` ("only included if identity change check enabled")                                                                                                                                             | W/webhooks/reference/messages/text (Nov 4, 2026)                                               | P:141-159 (contacts never read for messages); E:96-130                         | untested                                                                            | **missing**          | `MessageEvent.body` holds only the `messages[i]` object, so `value.contacts` cannot be reached at all: no profile name, username, wa_id, user_id or identity_key_hash. Contacts are used only as a user_preferences fallback (P:221-227).                                                                                                             |
| 6   | `context`: `{from, id}` for replies; `referred_product {catalog_id, product_retailer_id}` for "Message business" button; `forwarded` / `frequently_forwarded` for forwards                                                                                                                                                                                                                                          | W/webhooks/reference/messages/text (Nov 4, 2026)                                               | P:167-168, 180                                                                 | parser.test.ts "normalises interactive button_reply... surfaces context.id"         | drift                | Only `context.id` is typed. Forwarded flags and `referred_product` are reachable only through raw `body`.                                                                                                                                                                                                                                             |
| 7   | CTWA `referral`: `source_url, source_id, source_type, body, headline, media_type, image_url, video_url, thumbnail_url, ctwa_clid, welcome_message: { text }`; "The ctwa_clid property is omitted entirely for messages originating from an ad in WhatsApp Status"                                                                                                                                                   | W/webhooks/reference/messages/text (Nov 4, 2026)                                               | E:73-94, P:187-189                                                             | parser-ctwa.test.ts; fixture message-with-ctwa-referral.json                        | **drift**            | The type has `media_url` (not in the docs) and lacks `image_url` / `video_url`. It types `welcome_message.message_id`, but the docs say `welcome_message.text`. The fixture and test assert the undocumented `media_url`. Runtime passthrough keeps the real fields. The doc comment should say `ctwa_clid` may be absent (WhatsApp Status ads).      |
| 8   | Referral also appears on image/video/audio/document/sticker/location/contacts messages                                                                                                                                                                                                                                                                                                                              | W/webhooks/reference/messages/{image,video,audio,location,contacts} (Nov 4, 2026)              | P:187-189 (generic)                                                            | text only                                                                           | OK                   | Generic for any type. Only text is tested.                                                                                                                                                                                                                                                                                                            |
| 9   | `text: { body }`                                                                                                                                                                                                                                                                                                                                                                                                    | W/webhooks/reference/messages/text (Nov 4, 2026)                                               | P:31-47                                                                        | parser.test.ts "parses text-inbound"                                                | OK                   | Kind only; body is raw.                                                                                                                                                                                                                                                                                                                               |
| 10  | image / video: `{caption, mime_type, sha256, id, url}`; "url... being released to developers gradually... starting November 12, 2025"                                                                                                                                                                                                                                                                               | W/webhooks/reference/messages/image, /video (Nov 4, 2026)                                      | P:31-47                                                                        | untested                                                                            | OK (kind) / untested | No typed media accessor. `url` (direct download) is not surfaced.                                                                                                                                                                                                                                                                                     |
| 11  | audio: `{mime_type, sha256, id, url, voice}`; `voice` — "Boolean indicating if audio is a recording made with the WhatsApp client voice recording feature (true) or not (false)"                                                                                                                                                                                                                                    | W/webhooks/reference/messages/audio (Nov 4, 2026)                                              | P:31-47                                                                        | untested                                                                            | missing (typing)     | The `voice` flag is reachable only through raw `body.audio.voice`. There is no fixture.                                                                                                                                                                                                                                                               |
| 12  | document: `{caption, filename, mime_type, sha256, id, url}`                                                                                                                                                                                                                                                                                                                                                         | W/webhooks/reference/messages/document (Nov 4, 2026)                                           | P:31-47                                                                        | untested                                                                            | OK (kind) / untested |                                                                                                                                                                                                                                                                                                                                                       |
| 13  | sticker: `{mime_type, sha256, id, url, animated}`                                                                                                                                                                                                                                                                                                                                                                   | W/webhooks/reference/messages/sticker (Nov 4, 2026)                                            | P:31-47                                                                        | untested                                                                            | OK (kind) / untested |                                                                                                                                                                                                                                                                                                                                                       |
| 14  | location: `{address, latitude, longitude, name, url}`                                                                                                                                                                                                                                                                                                                                                               | W/webhooks/reference/messages/location (Nov 4, 2026)                                           | P:31-47                                                                        | untested                                                                            | OK (kind) / untested |                                                                                                                                                                                                                                                                                                                                                       |
| 15  | contacts message: `contacts[] {addresses, birthday, emails, name, org, phones[{phone, wa_id, type}], urls}`. BSUID page adds `vcard` and `origin` (`contact_request` \| `other`) for REQUEST_CONTACT_INFO shares                                                                                                                                                                                                    | W/webhooks/reference/messages/contacts (Nov 4, 2026); W/business-scoped-user-ids (Nov 5, 2026) | P:31-47                                                                        | untested                                                                            | drift                | Kind is OK. `origin: "contact_request"` is how a username user's phone number arrives, and it is not surfaced.                                                                                                                                                                                                                                        |
| 16  | interactive `button_reply {id, title}` and `list_reply {id, title, description}`                                                                                                                                                                                                                                                                                                                                    | W/webhooks/reference/messages/interactive (Nov 4, 2026)                                        | P:193-202                                                                      | parser.test.ts (button-reply.json, list-reply.json)                                 | OK                   |                                                                                                                                                                                                                                                                                                                                                       |
| 17  | interactive `"type": "product"`, `product {retailer_id, title, description, currency_code, price_amount, sale_price_amount, url}` — "A WhatsApp user sends a single-product message from a business's catalog."                                                                                                                                                                                                     | W/webhooks/reference/messages/interactive (Nov 4, 2026)                                        | P:198-201 (falls to `"unsupported"`)                                           | parser.test.ts "unknown interactive sub-type → unsupported"                         | **missing**          | A documented sub-type is classified as `unsupported`.                                                                                                                                                                                                                                                                                                 |
| 18  | `nfm_reply`: "type always nfm_reply"; `response_json` string; "The Flow response does not include the Flow ID... use flow_token"                                                                                                                                                                                                                                                                                    | W/flows/guides/receiveflowresponse (Nov 4, 2026)                                               | P:200, E:44-49                                                                 | parser.test.ts (interactive-nfm-reply.json)                                         | OK                   |                                                                                                                                                                                                                                                                                                                                                       |
| 19  | `button` (template quick reply): `button: { payload, text }` + `context {from, id}` — "A WhatsApp user taps a quick-reply button in a template message."                                                                                                                                                                                                                                                            | W/webhooks/reference/messages/button (Nov 4, 2026)                                             | P:40                                                                           | untested                                                                            | OK / untested        | No fixture for template quick-reply. (`button-reply.json` is interactive.)                                                                                                                                                                                                                                                                            |
| 20  | reaction: `reaction {message_id, emoji}` — "If the user removes their initial reaction, another webhook is triggered, but the payload omits the emoji property."                                                                                                                                                                                                                                                    | W/webhooks/reference/messages/reaction (Nov 4, 2026)                                           | P:42                                                                           | untested                                                                            | OK / untested        | Consumers must handle a missing emoji as un-react. Not documented in E.                                                                                                                                                                                                                                                                               |
| 21  | order: `order {catalog_id, text, product_items[{product_retailer_id, quantity, item_price, currency}]}`                                                                                                                                                                                                                                                                                                             | W/webhooks/reference/messages/order (Nov 4, 2026)                                              | P:41                                                                           | untested                                                                            | OK / untested        |                                                                                                                                                                                                                                                                                                                                                       |
| 22  | system: "Unlike other incoming messages webhooks, system messages webhooks don't include a contacts array." Types `user_changed_number` / `user_changed_user_id`; `system {body, wa_id, type, user_id, parent_user_id, previous_user_id, previous_parent_user_id}`; for `user_changed_user_id`, `from` is omitted                                                                                                   | W/webhooks/reference/messages/system (Aug 11, 2026)                                            | P:43                                                                           | untested                                                                            | **missing**          | BSUID rotation is the only way to rejoin identity ("this is how you join the new identity to the one you already had on file"). The SDK has no typed accessor, no fixture, and `from` becomes `""`.                                                                                                                                                   |
| 23  | "There is no user_id_update webhook field. BSUID changes are delivered on the messages field as a system message."                                                                                                                                                                                                                                                                                                  | W/business-scoped-user-ids (Nov 5, 2026)                                                       | P:121-130                                                                      | —                                                                                   | OK                   | Would be `unknown` anyway.                                                                                                                                                                                                                                                                                                                            |
| 24  | request_welcome — changelog Mar 27, 2026: "Removed the request_welcome webhook and welcome message feature from conversational components. This feature is no longer supported."                                                                                                                                                                                                                                    | W/changelog (Nov 20, 2026)                                                                     | P:44, E:54-59                                                                  | parser.test.ts "request_welcome"                                                    | drift                | The type is harmless to keep. The doc comment ("trigger for a welcome message inside the 72 h free entry-point window") describes a removed feature. Mark it deprecated.                                                                                                                                                                              |
| 25  | unsupported: `errors[{code, title, message, error_data.details}]` + `unsupported: { type }`. "Incoming message errors appear in the messages array (entry.changes.value.messages.errors). These webhooks have type set to unsupported."                                                                                                                                                                             | W/webhooks/reference/messages/unsupported (Nov 4, 2026); /messages (Nov 4, 2026)               | P:45, 203-206                                                                  | parser.test.ts "unknown top-level message type → unsupported"                       | drift                | Kind is OK. `messages[].errors` and `unsupported.type` are not typed or surfaced.                                                                                                                                                                                                                                                                     |
| 26  | NEW coexistence types: `"type": "edit"` (`edit {original_message_id, message{...}}`) and `"type": "revoke"` (`revoke {original_message_id}`) — "only available to WhatsApp Business app users (aka 'Coexistence')"                                                                                                                                                                                                  | W/webhooks/reference/messages/edit, /revoke (Nov 4, 2026)                                      | P:203-206 (→ `unsupported`)                                                    | untested                                                                            | missing              | Low priority unless you use Coexistence. Both are collapsed into `unsupported`.                                                                                                                                                                                                                                                                       |
| 27  | NEW group messages: `messages[].group_id` — "appears when a WhatsApp user or business sends, receives, or reads a message in a group"                                                                                                                                                                                                                                                                               | W/webhooks/reference/messages/group (Nov 4, 2026)                                              | P:161-191                                                                      | untested                                                                            | missing              | `group_id` is not surfaced, so group and 1:1 messages cannot be told apart without raw `body`.                                                                                                                                                                                                                                                        |
| 28  | NEW `value.conversation_context {type: "summary", summary: {text}}` "appears alongside the messages array"; "Treat conversation_context as optional in your code."                                                                                                                                                                                                                                                  | W/conversation-routing/conversation-context (Nov 4, 2026); changelog Sep 23, 2026              | P:141-159                                                                      | untested                                                                            | missing              | Applies only with Conversation Routing / Meta Business Agent. The value is dropped.                                                                                                                                                                                                                                                                   |
| 29  | Value-level errors: "System-, app-, and account-level errors appear as a value object property (entry.changes.value.errors)." Shape `errors[{code, title, message, error_data.details, href}]`                                                                                                                                                                                                                      | W/webhooks/reference/messages/errors (Jun 17, 2026); /messages (Nov 4, 2026)                   | P:141-159                                                                      | untested                                                                            | **bug**              | A `messages` change carrying only `value.errors` produces **zero events**. Platform errors are dropped silently. Emit an `error`/`unknown` event.                                                                                                                                                                                                     |
| 30  | Status fields: `id, status, timestamp, recipient_id` ("omitted if message sent to BSUID and user's phone number is unavailable"), `recipient_user_id` ("omitted with failed status if message sent to phone number"), `recipient_parent_user_id`, `recipient_type: "group"`, `recipient_participant_id`, `recipient_identity_key_hash`, `biz_opaque_callback_data`                                                  | W/webhooks/reference/messages/status (Nov 18, 2026)                                            | P:250-289; E:142-181                                                           | parser.test.ts status-sent / status-sent-pmp / status-failed                        | **missing**          | Only `recipientId` is surfaced. `recipient_user_id` is missing, so statuses for BSUID-only sends have no recipient. Also missing: `biz_opaque_callback_data` (correlation), group fields, identity hash. There is no raw passthrough on `StatusEvent`, so these fields cannot be reached at all.                                                      |
| 31  | Status values: `sent, delivered, read, failed, played` ("the first time a voice message is played"); "the 'delivered' webhook is not sent because it's implied... since it was read"                                                                                                                                                                                                                                | W/webhooks/reference/messages/status (Nov 18, 2026)                                            | E:140, R:217                                                                   | receiver.test.ts "does NOT collapse status transitions"                             | OK                   | `played` passes through the widened union, but is untested. State machines must accept read without delivered.                                                                                                                                                                                                                                        |
| 32  | `pricing {billable, pricing_model, type, category, subtype}`; "only included with sent status, and one of either delivered or read status"; "(the object can only appear in one or the other)"; `billable` "will be deprecated in a future versioned release. Use pricing.type and pricing.category"                                                                                                                | W/webhooks/reference/messages/status (Nov 18, 2026)                                            | P:258-265, 281-284; E:156-178                                                  | parser.test.ts status-sent, status-sent-pmp                                         | **drift**            | `pricing.subtype` (`free_tier` / `paid_exempt`, added Oct 12 and Nov 18, 2026) is not parsed. The E:157-161 comment says pricing is "Present on the first billable status (`sent`)", but per the docs it may arrive on delivered or read instead. `billable` is not flagged as deprecated.                                                            |
| 33  | `pricing.type` values: `regular`, `free_customer_service` ("As of October 1, 2026, indicates a free 1:1 service delivery, such as one within the business phone number's free tier"), `free_entry_point`, `free_group_customer_service`; `category` adds `group_marketing, group_service, group_utility, marketing_lite`                                                                                            | W/webhooks/reference/messages/status (Nov 18, 2026)                                            | E:156-171                                                                      | status-sent-pmp.json                                                                | drift                | Strings pass through (OK). The E:164-170 doc comment is stale: it says `free_customer_service` is "free until Oct 1, 2026", but after that date the value still exists with new meaning. It omits `free_group_customer_service` and the group/marketing_lite categories.                                                                              |
| 34  | `conversation {id, expiration_timestamp, origin.type}` — "Omitted entirely for v24.0+ unless webhook is for a free entry point conversation"                                                                                                                                                                                                                                                                        | W/webhooks/reference/messages/status (Nov 18, 2026)                                            | P:255-257; E:150-155                                                           | parser.test.ts status-sent / -pmp                                                   | OK                   | `origin.type` and `expiration_timestamp` are not surfaced (minor).                                                                                                                                                                                                                                                                                    |
| 35  | Status `errors[{code, title, message, error_data: {details}, href}]`                                                                                                                                                                                                                                                                                                                                                | W/webhooks/reference/messages/status (Nov 18, 2026)                                            | P:266-268; E:180                                                               | parser.test.ts "failed status carrying errors[]"                                    | drift                | The type omits `error_data.details` and `href`. They are present at runtime because the array is passed through. Also: "Starting March 2027, 131066 will be returned instead of 131049" for marketing quality/max price (changelog Nov 20, 2026). Pacing drops arrive as failed with `135000` (W/templates/portfolio-pacing, May 21, 2026).           |
| 36  | Status `contacts[]`: "Only included for sent, delivered, and read status messages. Will be omitted entirely for failed"; `username` "omitted entirely for sent status"                                                                                                                                                                                                                                              | W/business-scoped-user-ids (Nov 5, 2026)                                                       | P:250-289                                                                      | untested                                                                            | missing              | Status-side contacts (`user_id`, `username`, profile name) are not surfaced.                                                                                                                                                                                                                                                                          |
| 37  | user_preferences: `user_preferences[{wa_id, user_id, parent_user_id, detail, category: "marketing_messages", value: stop\|resume, timestamp (Integer)}]`; "wa_id is omitted if the user has enabled the username feature and their phone number cannot be shared with you"; "parent_user_id... is never applied at the parent BSUID level"                                                                          | W/webhooks/reference/user_preferences (Aug 13, 2026)                                           | P:214-248; E:252-264                                                           | parser.test.ts user_preferences ×2; receiver.test.ts                                | **bug**              | `user_id` is not surfaced. When `wa_id` is missing in both places, `waId = ""` (P:232). The dedupe key `pref::marketing_messages:stop:<ts>` (R:221) then **collides across different BSUID-only users who opt out in the same second**, so the second user's opt-out is dropped as a duplicate. That is a compliance risk. Key on `user_id ?? wa_id`. |
| 38  | Other `whatsapp_business_account` fields: account_update, business_capability_update, history, smb_message_echoes, smb_app_state_sync, message_template_components_update, phone_number_name_update, security, partner_solutions, payment_configuration_update, automatic_events, calls, business_username_updates (new; `context: "revoked"` added Sep 15, 2026), account_settings_update (changelog Nov 12, 2026) | W/webhooks/overview (Nov 4, 2026); W/business-scoped-user-ids                                  | P:121-130                                                                      | parser.test.ts "surfaces unknown fields as kind:'unknown'"                          | OK (forward-compat)  | All surface as `unknown` with raw value. That is acceptable. smb_message_echoes and history matter only for Coexistence.                                                                                                                                                                                                                              |
| 39  | Signature: "X-Hub-Signature-256: sha256=<SHA256_PAYLOAD_HASH>"; "Generate an HMAC-SHA256 hash using the JSON payload as the message input and your app secret as the secret key. Compare your generated hash to the hash assigned to the X-Hub-Signature-256 header (everything after sha256=)."                                                                                                                    | W/webhooks/create-webhook-endpoint (Jun 17, 2026)                                              | S:27-47, A:106-107                                                             | signature.test.ts, signature-properties.test.ts, signature-webcrypto-parity.test.ts | OK                   | Raw bytes are read once and compared in constant time. The SDK also accepts a header with no `sha256=` prefix (S:35-37), which is more lenient than the docs but harmless.                                                                                                                                                                            |
| 40  | "If the request is valid, respond with HTTP status 200. Otherwise, respond with a 400-level HTTP status"                                                                                                                                                                                                                                                                                                            | W/webhooks/create-webhook-endpoint (Jun 17, 2026)                                              | R:142-146, A:116-129                                                           | receiver.test.ts "returns 401 on a bad signature"                                   | OK                   | Returns 401.                                                                                                                                                                                                                                                                                                                                          |
| 41  | GET handshake: `hub.mode=subscribe&hub.challenge=..&hub.verify_token=..`; "compare the hub.verify_token value... respond with HTTP status 200 and the hub.challenge value. If the request is invalid, respond with a 400-level HTTP status code"                                                                                                                                                                    | W/webhooks/create-webhook-endpoint (Jun 17, 2026)                                              | H:24-42, R:126-135, A:88-101                                                   | handshake.test.ts, receiver.test.ts handleVerifyRequest                             | OK                   | Returns 403 on mismatch. Also checks `mode === "subscribe"`, which is stricter than the docs and fine.                                                                                                                                                                                                                                                |
| 42  | Retries: "If any POST request sent to your server fails, delivery is retried immediately, then a few more times with decreasing frequency over the next 7 days. Your server should handle deduplication"; "Meta retries delivery with decreasing frequency until the request succeeds, for up to 7 days... These retries can result in duplicate webhook notifications."                                            | W/webhooks/create-webhook-endpoint (Jun 17, 2026); W/webhooks/overview (Nov 4, 2026)           | R:154-170, 212-225; `src/types/constants.ts:9` (`WEBHOOK_DEDUPE_TTL_MS = 24h`) | dedupe.test.ts, receiver.test.ts "dedupes", receiver-concurrent-dedupe.test.ts      | **drift**            | The dedupe TTL is 24 h, but the redelivery window is 7 days. A retry arriving after 24 h is dispatched again. Default to 7 days or document it.                                                                                                                                                                                                       |
| 43  | Ack deadline: no timeout figure appears on the current create-webhook-endpoint or overview pages                                                                                                                                                                                                                                                                                                                    | W/webhooks/create-webhook-endpoint (Jun 17, 2026); W/webhooks/overview (Nov 4, 2026)           | A:18-19, 118-127; R:79 ("Meta's 30s ack rule")                                 | untested                                                                            | drift (UNVERIFIED)   | No current Meta page supports the SDK's "30 s" claim. Ack-before-dispatch is still sound. Note that because the SDK returns 200 before handlers finish and marks dedupe **before** running handlers (R:159), a handler failure is lost with no Meta retry. Consumers must persist first.                                                              |
| 44  | "There are no APIs for fetching historical webhook data, so capture and store webhook payloads accordingly."                                                                                                                                                                                                                                                                                                        | W/webhooks/create-webhook-endpoint (Jun 17, 2026)                                              | R:137-147                                                                      | —                                                                                   | OK (design note)     | The SDK exposes no raw-payload hook before parse. Consumers can store `rawBody` themselves in their own handler.                                                                                                                                                                                                                                      |
| 45  | "POST requests are aggregated and sent in a batch with a maximum of 1000 updates"; "Webhook payloads can be up to 3 MB."                                                                                                                                                                                                                                                                                            | W/webhooks/create-webhook-endpoint; W/webhooks/overview                                        | P:58-77, R:156-161                                                             | parser.test.ts "splits two messages"                                                | OK                   | Dedupe runs `await` one at a time per event (R:159). With 1000 updates on remote storage this is slow, but it happens after the 200, so acceptable.                                                                                                                                                                                                   |
| 46  | `identity_key_hash` on contacts / `recipient_identity_key_hash` on statuses — "Only included if you have enabled the identity change check feature." (Legacy `messages[].identity {acknowledged, created_timestamp, hash}` does not appear in any current reference page.)                                                                                                                                          | W/webhooks/reference/messages/text (Nov 4, 2026); W/identity-change (May 21, 2026)             | —                                                                              | untested                                                                            | missing              | Not surfaced. Contacts are dropped (#5) and statuses have no raw passthrough (#30). The legacy `identity` object is UNVERIFIED (memory only).                                                                                                                                                                                                         |
| 47  | Timestamps: messages `"timestamp": "<WEBHOOK_TRIGGER_TIMESTAMP>"` String; user_preferences `timestamp` Integer                                                                                                                                                                                                                                                                                                      | W/webhooks/reference/messages/text; W/webhooks/reference/user_preferences                      | P:405-412                                                                      | parser.test.ts timestamp tests                                                      | OK                   |                                                                                                                                                                                                                                                                                                                                                       |

## Verbatim doc payloads (proposed fixtures)

All payloads are copied from the fetched page text (en_US) on 2026-11-26.

### 1. BSUID / username incoming message (phone number unavailable)

Source: W/webhooks/reference/messages/text, "Text message from a user with a username" (Updated Nov 4, 2026).

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Sheena Nelson",
                  "username": "realsheenanelson"
                },
                "user_id": "US.13491208655302741918"
              }
            ],
            "messages": [
              {
                "from_user_id": "US.13491208655302741918",
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
                "timestamp": "1749416383",
                "type": "text",
                "text": {
                  "body": "Does it come in another color?"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

Variant with parent BSUID. Source: W/business-scoped-user-ids, "Incoming messages webhooks" (Updated Nov 5, 2026).

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Sheena Nelson",
                  "username": "realsheenanelson"
                },
                "user_id": "US.13491208655302741918",
                "parent_user_id": "US.ENT.11815799212886844830"
              }
            ],
            "messages": [
              {
                "from_user_id": "US.13491208655302741918",
                "from_parent_user_id": "US.ENT.11815799212886844830",
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
                "timestamp": "1749416383",
                "type": "text",
                "text": {
                  "body": "Does it come in another color?"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

BSUID rotation (system `user_changed_user_id`, no phone number). Source: W/webhooks/reference/messages/system (Updated Aug 11, 2026).

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "messages": [
              {
                "id": "wamid.HBgLMTk4MzU1NTE5NzQVAgASGAoxMTgyMDg2MjY3AA==",
                "timestamp": "1750269342",
                "system": {
                  "body": "User changed from US.10230984751029384756 to US.13491208655302741918",
                  "type": "user_changed_user_id",
                  "user_id": "US.13491208655302741918",
                  "parent_user_id": "US.ENT.506847293015824",
                  "previous_user_id": "US.10230984751029384756",
                  "previous_parent_user_id": "US.ENT.918273645500112"
                },
                "type": "system"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 2. CTWA referral message

Source: W/webhooks/reference/messages/text, "Click to WhatsApp ad" (Updated Nov 4, 2026).

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Sheena Nelson"
                },
                "wa_id": "16505551234",
                "user_id": "US.13491208655302741918"
              }
            ],
            "messages": [
              {
                "referral": {
                  "source_url": "https://fb.me/3cr4Wqqkv",
                  "source_id": "120226305854810726",
                  "source_type": "ad",
                  "body": "Summer Succulents are here!",
                  "headline": "Chat with us",
                  "media_type": "image",
                  "image_url": "https://scontent.xx.fbcdn.net/v/t45.1...",
                  "ctwa_clid": "Aff-n8ZTODiE79d22KtAwQKj9e_mIEOOj27vDVwFjN80dp4_0NiNhEgpGo0AHemvuSoifXaytfTzcchptiErTKCqTrJ5nW1h7IHYeYymGb5K5J5iTROpBhWAGaIAeUzHL50",
                  "welcome_message": {
                    "text": "Hi there! Let us know how we can help!"
                  }
                },
                "from": "16505551234",
                "from_user_id": "US.13491208655302741918",
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUQ0N0VFMDA2MTQ0RkJFNkNDNAA=",
                "timestamp": "1750275992",
                "text": {
                  "body": "Can I get more info about this?"
                },
                "type": "text"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 3. Voice audio

Source: W/webhooks/reference/messages/audio, "Example" (Updated Nov 4, 2026).

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Sheena Nelson"
                },
                "wa_id": "16505551234",
                "user_id": "US.13491208655302741918"
              }
            ],
            "messages": [
              {
                "from": "16505551234",
                "from_user_id": "US.13491208655302741918",
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
                "timestamp": "1744344496",
                "type": "audio",
                "audio": {
                  "mime_type": "audio/ogg; codecs=opus",
                  "sha256": "wvqXMe6n7n1W0zphvLPoLj+s/NtKqmr3zZ7YzTP7xFI=",
                  "id": "1908647269898587",
                  "url": "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=133...",
                  "voice": true
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 4. Interactive button_reply

Source: W/webhooks/reference/messages/interactive (Updated Nov 4, 2026).

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Sheena Nelson"
                },
                "wa_id": "16505551234",
                "user_id": "US.13491208655302741918"
              }
            ],
            "messages": [
              {
                "context": {
                  "from": "15550783881",
                  "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBI3MEM2RUJFNkI0RENGQTVDRjUA"
                },
                "from": "16505551234",
                "from_user_id": "US.13491208655302741918",
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTZBQzg0MzQ4QjRCM0NGNkVGOAA=",
                "timestamp": "1750025136",
                "type": "interactive",
                "interactive": {
                  "type": "button_reply",
                  "button_reply": {
                    "id": "cancel-button",
                    "title": "Cancel"
                  }
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 5. Interactive list_reply

Source: W/webhooks/reference/messages/interactive (Updated Nov 4, 2026).

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Sheena Nelson"
                },
                "wa_id": "16505551234",
                "user_id": "US.13491208655302741918"
              }
            ],
            "messages": [
              {
                "context": {
                  "from": "15550783881",
                  "id": "wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA="
                },
                "from": "16505551234",
                "from_user_id": "US.13491208655302741918",
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
                "timestamp": "1749854575",
                "type": "interactive",
                "interactive": {
                  "type": "list_reply",
                  "list_reply": {
                    "id": "priority_express",
                    "title": "Priority Mail Express",
                    "description": "Next Day to 2 Days"
                  }
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

Bonus (currently mis-classified as `unsupported`): interactive `product`, from the same page.

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Sheena Nelson"
                },
                "wa_id": "16505551234",
                "user_id": "US.13491208655302741918"
              }
            ],
            "messages": [
              {
                "from": "16505551234",
                "from_user_id": "US.13491208655302741918",
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTZBQzg0MzQ4QjRCM0NGNkVGOAA=",
                "timestamp": "1750025136",
                "type": "interactive",
                "interactive": {
                  "type": "product",
                  "product": {
                    "retailer_id": "2lc20305pt",
                    "title": "Classic T-Shirt",
                    "description": "100% cotton, unisex fit",
                    "currency_code": "USD",
                    "price_amount": 1000,
                    "sale_price_amount": 800,
                    "url": "https://example.com/products/classic-t-shirt"
                  }
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 6. Template quick-reply button (`type: "button"`)

Source: W/webhooks/reference/messages/button, "Example" (Updated Nov 4, 2026).

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Sheena Nelson"
                },
                "wa_id": "16505551234",
                "user_id": "US.13491208655302741918"
              }
            ],
            "messages": [
              {
                "context": {
                  "from": "15550783881",
                  "id": "wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA="
                },
                "from": "16505551234",
                "from_user_id": "US.13491208655302741918",
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
                "timestamp": "1750091045",
                "type": "button",
                "button": {
                  "payload": "Unsubscribe",
                  "text": "Unsubscribe"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 7. Status with pricing

Source: W/webhooks/reference/messages/status, "a marketing message that has been successfully sent" (Updated Nov 18, 2026).

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Pablo M."
                },
                "wa_id": "16505551234",
                "user_id": "US.13491208655302741918"
              }
            ],
            "statuses": [
              {
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
                "status": "sent",
                "timestamp": "1750030073",
                "recipient_id": "16505551234",
                "recipient_user_id": "US.13491208655302741918",
                "conversation": {
                  "id": "72b14d6bd5407799e66f64d1b338e567",
                  "expiration_timestamp": "1750116480",
                  "origin": {
                    "type": "marketing"
                  }
                },
                "pricing": {
                  "billable": true,
                  "pricing_model": "PMP",
                  "type": "regular",
                  "category": "marketing"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

Delivered status sent to a BSUID, with parent BSUID and pricing. Source: W/business-scoped-user-ids (Updated Nov 5, 2026).

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Pablo M.",
                  "username": "pablomorales"
                },
                "user_id": "US.13491208655302741918",
                "parent_user_id": "US.ENT.11815799212886844830"
              }
            ],
            "statuses": [
              {
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
                "status": "delivered",
                "timestamp": "1750030073",
                "recipient_user_id": "US.13491208655302741918",
                "recipient_parent_user_id": "US.ENT.11815799212886844830",
                "pricing": {
                  "billable": true,
                  "pricing_model": "PMP",
                  "type": "regular",
                  "category": "marketing"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

No doc example shows `pricing.subtype`. The syntax block on W/webhooks/reference/messages/status gives `"subtype": "<PRICING_SUBTYPE>" <!-- Only included for free service messages -->`, with values `free_tier` and `paid_exempt`. A fixture for it would have to be synthesized and labelled as such.

## Pages fetched, and gaps

- **Fetched successfully (en_US):**
  - W/business-scoped-user-ids
  - W/webhooks/overview
  - W/webhooks/create-webhook-endpoint
  - W/webhooks/reference/messages, plus the sub-pages audio, button, contacts, document, edit, errors, group, image, interactive, location, order, reaction, revoke, status, sticker, system, text, unsupported, video
  - W/webhooks/reference/user_preferences
  - W/flows/guides/receiveflowresponse
  - W/conversation-routing/conversation-context
  - W/identity-change
  - W/templates/portfolio-pacing
  - W/changelog
- **Fetched but not analysed:** reference/history, reference/smb_message_echoes and reference/account_update. Their fields map to `unknown`.
- **Identity-change payload:** W/identity-change has no payload example in its text. The legacy `messages[].identity` object is therefore UNVERIFIED.
- **Ack timeout:** no current Meta page states one. The SDK's "30 s" claim is UNVERIFIED.
