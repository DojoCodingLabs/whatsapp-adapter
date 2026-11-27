## MODIFIED Requirements

### Requirement: Client construction with typed credentials

The package SHALL export a `WhatsAppClient` class whose constructor accepts a single options object of shape `{ phoneNumberId: string; wabaId?: string; token: string | TokenProvider; appSecret: string; graphApiVersion?: string }`, where `TokenProvider = () => string | Promise<string>`. When `wabaId` is omitted, `instance.wabaId` SHALL be `""`. The constructor SHALL store the resolved credentials but SHALL NOT perform any network I/O AND SHALL NOT invoke a `TokenProvider` callback at construction time. The package SHALL export the `TokenProvider` type for consumers who want to type their own provider implementations.

#### Scenario: Construction without `graphApiVersion`

- **WHEN** the constructor is called without `graphApiVersion`
- **THEN** `instance.graphApiVersion` equals the exported `GRAPH_API_VERSION` constant (currently `"v26.0"`)

#### Scenario: Construction with a string token (legacy shape)

- **WHEN** the constructor is called with `token: "ABC"`
- **THEN** the instance is constructed successfully
- **AND** the first request's Authorization header is `Bearer ABC`

#### Scenario: Construction with a TokenProvider callback

- **WHEN** the constructor is called with `token: () => "ABC"`
- **THEN** the instance is constructed successfully
- **AND** the callback is NOT invoked during construction
- **AND** the first request's Authorization header is `Bearer ABC`

#### Scenario: Construction with an async TokenProvider callback

- **WHEN** the constructor is called with `token: async () => "ABC"`
- **THEN** the instance is constructed successfully
- **AND** the first request resolves the Promise and uses the result

#### Scenario: Send-only client without wabaId

- **WHEN** the constructor is called without `wabaId`
- **THEN** the instance is constructed successfully and `instance.wabaId === ""`
- **AND** `listTemplates()` rejects with `MissingCredentialsError` whose `missingFields` is `["wabaId"]`
- **AND** `MockWhatsAppClient` behaves the same way

### Requirement: Credential validation at construction time

The constructor SHALL throw `MissingCredentialsError` if `phoneNumberId` or `appSecret` is missing or empty, OR if `token` is neither a non-empty string nor a function. `wabaId` is optional; it is validated by the WABA-scoped calls that need it. The error message SHALL name the missing field(s) but SHALL NOT include the value of any credential. A `TokenProvider` callback's runtime behaviour (whether it throws, returns empty, returns a non-string) SHALL NOT be validated at construction; it is validated per request and SHALL throw `AuthenticationError` at that time.

#### Scenario: Missing token (neither string nor function)

- **WHEN** the constructor is called with `token` set to `undefined`, `null`, `""`, `0`, or `{}`
- **THEN** a `MissingCredentialsError` is thrown
- **AND** `error.code === "MISSING_CREDENTIALS"`
- **AND** `error.missingFields` contains `"token"`

#### Scenario: Multiple missing fields

- **WHEN** the constructor is called with empty `phoneNumberId` AND empty `appSecret`
- **THEN** a `MissingCredentialsError` is thrown listing both `"phoneNumberId"` and `"appSecret"` in `error.missingFields`

#### Scenario: Credential value never appears in error

- **WHEN** the constructor is called with a non-empty `token` but empty `phoneNumberId`
- **THEN** the thrown error's `message` and JSON serialization SHALL NOT contain the substring of `token`

#### Scenario: TokenProvider callback is not invoked at construction

- **WHEN** the constructor is called with `token: () => { throw new Error("boom") }`
- **THEN** the instance is constructed successfully
- **AND** the error is not surfaced until the first request
