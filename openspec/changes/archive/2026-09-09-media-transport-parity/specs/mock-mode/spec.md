## ADDED Requirements

### Requirement: Mock media and ack methods mirror the real client's pre-flight
`MockWhatsAppClient.uploadMedia` SHALL run the same `validateUploadInput` as `WhatsAppClient.uploadMedia` — rejecting a malformed input with `WhatsAppError("UNKNOWN")` and an oversize payload with `WhatsAppError("CAPABILITY")` — before recording the upload. `MockWhatsAppClient.downloadMedia("")`, `markAsRead({ messageId: "" })`, `getTemplate("")` and `sendReply("", …)` SHALL reject with `WhatsAppError("UNKNOWN")`, matching the real client. The mock SHALL NOT keep a private copy of the upload byte-length logic.

#### Scenario: Oversize image is rejected by both clients
- **WHEN** `uploadMedia({ file: new Uint8Array(5 * 1024 * 1024 + 1), mimeType: "image/jpeg" })` is awaited on a `WhatsAppClient` (stubbed) and on a `MockWhatsAppClient`
- **THEN** both reject with a `WhatsAppError` whose `code === "CAPABILITY"`
- **AND** the real client made no HTTP request

#### Scenario: Upload → download → fetchBytes round-trip has the same shape on both clients
- **WHEN** `const { id } = await c.uploadMedia({ file: new Uint8Array(4), mimeType: "image/jpeg" }); const info = await c.downloadMedia(id); const bytes = await info.fetchBytes()` runs on both clients
- **THEN** `Object.keys(info)` minus `fetchBytes` is `["fileSize", "id", "mimeType", "sha256", "url"]` on both
- **AND** `info.fileSize === 4` and `bytes.byteLength === 4` on both

#### Scenario: Input-shape rejections match
- **WHEN** `downloadMedia("")`, `markAsRead({ messageId: "" })` and `sendReply("", payload)` are awaited on both clients
- **THEN** each rejects with a `WhatsAppError` whose `code === "UNKNOWN"` on both
