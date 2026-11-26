## ADDED Requirements

### Requirement: Mock mirrors BSUID addressing, reaction-reply rejection, media caps and redaction

`MockWhatsAppClient` SHALL:

- accept `{ recipient }` sends, recording the payload exactly as the real client builds it;
- respond with `contacts: [{ input, user_id }]` (no `wa_id`) for BSUID sends;
- key window and opt-in gates on the same identifier as the real client;
- reject reaction payloads in `sendReply`;
- apply the upload MIME/family gate;
- reject `fetchBytes()` with `MediaTooLargeError` when the recorded size exceeds `maxBytes`;
- honour `redactProviderMessages` for pre-flight errors.

#### Scenario: BSUID parity

- **WHEN** both clients send `{ recipient: "US.13491208655302741918", body: "hi" }`
- **THEN** the mock's recorded payload equals the real client's wire body

#### Scenario: Mock maxBytes parity

- **WHEN** a mock-uploaded 2048-byte media is downloaded with `maxBytes: 1024`
- **THEN** `fetchBytes()` rejects with `MediaTooLargeError`
