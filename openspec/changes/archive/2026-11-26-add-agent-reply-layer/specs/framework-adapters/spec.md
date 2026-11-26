## ADDED Requirements

### Requirement: verifyAndParseWebhook for frameworks that own routing

The web sub-module SHALL export `verifyAndParseWebhook(req, { appSecret })`. It SHALL read the body bytes exactly once, verify `X-Hub-Signature-256` with the timing-safe `verifySignature` first, and resolve to `{ status: 401 }` on a bad signature, `{ status: 400 }` for a signed body that is not valid JSON (including empty), else `{ status: 200, events, rawBody }` via `parseWebhookPayload`. It SHALL NOT dedupe, dispatch or build a `Response`.

#### Scenario: Signed Meta payload

- **WHEN** a POST carries a captured Meta text payload and a correct signature
- **THEN** the result is `status: 200` with one `message` event and `rawBody` equal to the sent bytes

#### Scenario: Bad signature

- **WHEN** the signature header is missing, made with another secret, malformed, or the body was tampered with
- **THEN** the result is `{ status: 401 }`

#### Scenario: Signed non-JSON body

- **WHEN** the body is `not json` and correctly signed
- **THEN** the result is `{ status: 400 }`

#### Scenario: Unsigned non-JSON body

- **WHEN** the body is `not json` and unsigned
- **THEN** the result is `{ status: 401 }`

### Requirement: createWhatsAppHandler rejects signed non-JSON bodies with 400

On `POST`, `createWhatsAppHandler` SHALL respond `400` when the body is correctly signed but is not valid JSON (including an empty body), without dispatching or calling `waitUntil`. It SHALL respond `401` when such a body is not correctly signed. A correctly signed JSON body with no events SHALL still be acked `200`.

#### Scenario: Signed garbage is a 400

- **WHEN** a correctly signed POST body is `{`
- **THEN** the response is `400` and `waitUntil` is not called

#### Scenario: Signed JSON without events is still 200

- **WHEN** a correctly signed POST body is `{"object":"whatsapp_business_account","entry":[]}`
- **THEN** the response is `200`
