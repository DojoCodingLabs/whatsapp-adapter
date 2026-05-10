## MODIFIED Requirements

### Requirement: Client construction with typed credentials

The package SHALL export a `WhatsAppClient` class whose constructor accepts a single options object of shape `{ phoneNumberId: string; wabaId: string; token: string | TokenProvider; appSecret: string; graphApiVersion?: string }`, where `TokenProvider = () => string | Promise<string>`. The constructor SHALL store the resolved credentials but SHALL NOT perform any network I/O AND SHALL NOT invoke a `TokenProvider` callback at construction time. The package SHALL export the `TokenProvider` type for consumers who want to type their own provider implementations.

#### Scenario: Construction without `graphApiVersion`

- **WHEN** the constructor is called without `graphApiVersion`
- **THEN** `instance.graphApiVersion` equals the exported `GRAPH_API_VERSION` constant (currently `"v25.0"`)

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

### Requirement: Credential validation at construction time

The constructor SHALL throw `MissingCredentialsError` if `phoneNumberId`, `wabaId`, `appSecret` is missing or empty, OR if `token` is neither a non-empty string nor a function. The error message SHALL name the missing field(s) but SHALL NOT include the value of any credential. A `TokenProvider` callback's runtime behaviour (whether it throws, returns empty, returns a non-string) SHALL NOT be validated at construction; it is validated per request and SHALL throw `AuthenticationError` at that time.

#### Scenario: Missing token (neither string nor function)

- **WHEN** the constructor is called with `token` set to `undefined`, `null`, `""`, `0`, or `{}`
- **THEN** a `MissingCredentialsError` is thrown
- **AND** `error.code === "MISSING_CREDENTIALS"`
- **AND** `error.missingFields` contains `"token"`

#### Scenario: Multiple missing fields

- **WHEN** the constructor is called with empty `wabaId` AND empty `appSecret`
- **THEN** a `MissingCredentialsError` is thrown listing both `"wabaId"` and `"appSecret"` in `error.missingFields`

#### Scenario: Credential value never appears in error

- **WHEN** the constructor is called with a non-empty `token` but empty `wabaId`
- **THEN** the thrown error's `message` and JSON serialization SHALL NOT contain the substring of `token`

#### Scenario: TokenProvider callback is not invoked at construction

- **WHEN** the constructor is called with `token: () => { throw new Error("boom") }`
- **THEN** the instance is constructed successfully
- **AND** the error is not surfaced until the first request

### Requirement: Authenticated Graph API request method

The `WhatsAppClient` SHALL expose an `@internal` `request<T>(method, path, body?, options?)` method that issues an authenticated HTTP request against `${META_GRAPH_BASE_URL}/${graphApiVersion}/${path}`. The method SHALL resolve the bearer token per request via the `TokenProvider` callback (or by reading the stored string), set `Authorization: Bearer ${resolvedToken}`, `Content-Type: application/json` (when a body is provided), and `Accept: application/json` headers. On a 2xx response, the method SHALL parse the JSON body and resolve to it as `T`. On any non-2xx, the method SHALL throw a typed `WhatsAppError` produced by the error-code mapper.

The token SHALL be resolved exactly once per outer `request()` invocation, INSIDE the retry loop's fetch step, so all attempts within a single request use the same resolved value (re-resolving mid-retry would mask a stale-token bug).

#### Scenario: Successful 200 response is parsed and returned

- **WHEN** `request("GET", "/me")` is called and the server returns `200 { "id": "1" }`
- **THEN** the method resolves to `{ id: "1" }`
- **AND** the request bore `Authorization: Bearer <token>` and `Accept: application/json`

#### Scenario: 4xx with mapped Meta error code surfaces as typed error

- **WHEN** the Graph API returns `400` with body `{ error: { code: 131056, message: "pair rate limit" } }`
- **THEN** `request()` throws a `RateLimitError`
- **AND** `error.metaCode === 131056`
- **AND** `error.code === "RATE_LIMIT"`

#### Scenario: 5xx is surfaced as a `WhatsAppError` after exhausting retries

- **WHEN** the Graph API returns `503` on every attempt and the retry policy exhausts
- **THEN** `request()` throws a `WhatsAppError`
- **AND** `error.code === "UNKNOWN"`

#### Scenario: TokenProvider callback is invoked exactly once per request

- **WHEN** a `WhatsAppClient` is constructed with a callback that increments a counter, AND `request()` is called 3 times sequentially
- **THEN** the counter is `3` (one invocation per outer request)
- **AND** even if retries occur within a single request, the counter does not increment for the same outer request

#### Scenario: TokenProvider callback returns empty string

- **WHEN** a `WhatsAppClient` is constructed with `token: () => ""` AND `request("GET", "/me")` is called
- **THEN** `request()` throws an `AuthenticationError` BEFORE any HTTP request is made
- **AND** `error.code === "AUTHENTICATION"`

#### Scenario: TokenProvider callback throws

- **WHEN** a `WhatsAppClient` is constructed with `token: () => { throw new Error("provider boom") }` AND `request()` is called
- **THEN** `request()` throws an `AuthenticationError` BEFORE any HTTP request is made
- **AND** the `AuthenticationError` references the underlying provider error in its `cause` field
