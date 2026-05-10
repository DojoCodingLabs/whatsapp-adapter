## ADDED Requirements

### Requirement: Client construction with typed credentials
The package SHALL export a `WhatsAppClient` class whose constructor accepts a single options object of shape `{ phoneNumberId: string; wabaId: string; token: string; appSecret: string; graphApiVersion?: string }`. The constructor SHALL store the resolved credentials but SHALL NOT perform any network I/O.

#### Scenario: Construction with all required credentials
- **WHEN** `new WhatsAppClient({ phoneNumberId: "P", wabaId: "W", token: "T", appSecret: "S" })` is called
- **THEN** an instance is returned
- **AND** `instance.phoneNumberId === "P"` and `instance.wabaId === "W"`
- **AND** no HTTP request is sent to `graph.facebook.com`

#### Scenario: Construction with custom Graph API version
- **WHEN** the constructor is called with `graphApiVersion: "v22.0"`
- **THEN** `instance.graphApiVersion === "v22.0"`

#### Scenario: Construction without `graphApiVersion`
- **WHEN** the constructor is called without `graphApiVersion`
- **THEN** `instance.graphApiVersion` equals the exported `GRAPH_API_VERSION` constant (currently `"v23.0"`)

### Requirement: Credential validation at construction time
The constructor SHALL throw `MissingCredentialsError` if `phoneNumberId`, `wabaId`, `token`, or `appSecret` is missing or empty. The error message SHALL name the missing field(s) but SHALL NOT include the value of any credential.

#### Scenario: Missing token
- **WHEN** the constructor is called with an empty `token`
- **THEN** a `MissingCredentialsError` is thrown
- **AND** `error.code === "MISSING_CREDENTIALS"`
- **AND** `error.missingFields` contains `"token"`

#### Scenario: Multiple missing fields
- **WHEN** the constructor is called with empty `wabaId` AND empty `appSecret`
- **THEN** a `MissingCredentialsError` is thrown listing both `"wabaId"` and `"appSecret"` in `error.missingFields`

#### Scenario: Credential value never appears in error
- **WHEN** the constructor is called with a non-empty `token` but empty `wabaId`
- **THEN** the thrown error's `message` and JSON serialization SHALL NOT contain the substring of `token`

### Requirement: Pinned Graph API version exported as a constant
The package SHALL export a `GRAPH_API_VERSION` constant whose default value is the currently supported Meta Graph API version (`"v23.0"` at time of writing). The package SHALL also export a `META_GRAPH_BASE_URL` constant resolving to `"https://graph.facebook.com"`.

#### Scenario: GRAPH_API_VERSION is a string starting with "v"
- **WHEN** the consumer imports `GRAPH_API_VERSION` from `@dojocoding/whatsapp`
- **THEN** the imported value is a non-empty string
- **AND** it matches the pattern `/^v\d+\.\d+$/`

#### Scenario: Constants are immutable to TypeScript consumers
- **WHEN** a TypeScript consumer attempts `GRAPH_API_VERSION = "v0.0"` in strict mode
- **THEN** the TypeScript compiler reports an error (the export is `as const` / `readonly`)
