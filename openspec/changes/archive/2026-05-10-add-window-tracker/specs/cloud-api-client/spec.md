## ADDED Requirements

### Requirement: Optional WindowTracker on the WhatsAppClient
`WhatsAppClientOptions` SHALL accept an optional `windowTracker?: WindowTracker`. When set, free-form convenience send methods (`sendText`, `sendImage`, `sendVideo`, `sendAudio`, `sendDocument`, `sendSticker`, `sendLocation`, `sendContacts`, `sendInteractive`) SHALL pre-flight-check `windowTracker.isWindowOpen(to)` and SHALL throw `WindowClosedError(to)` BEFORE issuing the HTTP request when the window is closed. `sendTemplate` and `sendReaction` SHALL be window-exempt and SHALL NOT consult the tracker.

#### Scenario: Free-form send is gated when window is closed
- **WHEN** the client has a `WindowTracker` configured for which `isWindowOpen("X")` returns `false`
- **AND** `client.sendText({ to: "X", body: "hi" })` is called
- **THEN** the call rejects with `WindowClosedError`
- **AND** no outbound HTTP request is issued

#### Scenario: Free-form send proceeds when window is open
- **WHEN** the client has a `WindowTracker` and `notifyInbound("X")` was just called
- **AND** `client.sendText({ to: "X", body: "hi" })` is called
- **THEN** the request reaches the Graph API and resolves with the parsed response

#### Scenario: sendTemplate is window-exempt
- **WHEN** the client has a `WindowTracker` for which `isWindowOpen("X")` returns `false`
- **AND** `client.sendTemplate({ to: "X", name: "hello_world", language: "en_US" })` is called
- **THEN** the request reaches the Graph API; the tracker is NOT consulted

#### Scenario: sendReaction is window-exempt
- **WHEN** the same closed-window state holds and `client.sendReaction({ to: "X", messageId: "wamid.x", emoji: "👍" })` is called
- **THEN** the request reaches the Graph API

#### Scenario: No tracker configured leaves all sends ungated
- **WHEN** the client has NO `windowTracker` and the customer has never messaged the business
- **AND** `client.sendText(...)` is called
- **THEN** the request reaches the Graph API (Meta will reject with 131026, surfaced as `WindowClosedError` via `mapMetaError` — same end behaviour, just slower)
