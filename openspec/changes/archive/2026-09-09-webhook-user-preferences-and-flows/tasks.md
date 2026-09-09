## 1. Events

- [x] 1.1 `src/webhooks/events.ts`: `"interactive_nfm_reply"`, `"request_welcome"` in `IncomingMessageKind`; `UserPreferencesEvent`; added to `WhatsAppEvent` union.
- [x] 1.2 Export `UserPreferencesEvent` from `src/webhooks/index.ts`.

## 2. Parser

- [x] 2.1 `src/webhooks/parser.ts`: `nfm_reply` branch; `request_welcome` in `KNOWN_INCOMING_KINDS`.
- [x] 2.2 `parseUserPreferences` — one event per entry, `wa_id` fallback to `contacts[0]`, entry timestamp, metadata copied.

## 3. Receiver

- [x] 3.1 `src/webhooks/receiver.ts`: `EventKindMap.user_preferences`; dedupe key `pref:${waId}:${category}:${value}:${timestamp}`.

## 4. Fixtures + tests

- [x] 4.1 `test/__fixtures__/webhooks/{user-preferences-stop,interactive-nfm-reply,request-welcome}.json`.
- [x] 4.2 `test/unit/webhooks/parser.test.ts`: nfm_reply typed + `response_json` preserved; `request_welcome` typed with referral; `user_preferences` stop parsed; contacts fallback + multi-entry.
- [x] 4.3 `test/unit/webhooks/receiver.test.ts`: typed dispatch, replay dedupe, drives `InMemoryOptInRegistry` (MARKETING out, UTILITY still in).

## 5. Docs

- [x] 5.1 `docs/sdk/webhooks.md`: event table row, `IncomingMessageKind` listing, Flows / welcome notes, "Marketing opt-out signal" section.
- [x] 5.2 `docs/sdk/opt-in.md`: "Meta's native opt-out signal" section ahead of keyword handling.
