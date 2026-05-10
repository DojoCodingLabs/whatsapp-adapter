## MODIFIED Requirements

### Requirement: Client construction with typed credentials

The package SHALL export a `WhatsAppClient` class whose constructor accepts a single options object of shape `{ phoneNumberId: string; wabaId: string; token: string; appSecret: string; graphApiVersion?: string }`. The constructor SHALL store the resolved credentials but SHALL NOT perform any network I/O.

#### Scenario: Construction without `graphApiVersion`

- **WHEN** the constructor is called without `graphApiVersion`
- **THEN** `instance.graphApiVersion` equals the exported `GRAPH_API_VERSION` constant (currently `"v25.0"`)

### Requirement: Pinned Graph API version exported as a constant

The package SHALL export a `GRAPH_API_VERSION` constant whose default value is the currently supported Meta Graph API version (`"v25.0"` at time of writing). The package SHALL also export a `META_GRAPH_BASE_URL` constant resolving to `"https://graph.facebook.com"`.

#### Scenario: GRAPH_API_VERSION is a string starting with "v"

- **WHEN** the consumer imports `GRAPH_API_VERSION` from `@dojocoding/whatsapp`
- **THEN** the imported value is a non-empty string
- **AND** it matches the pattern `/^v\d+\.\d+$/`

### Requirement: URL construction uses the resolved Graph API version

The `request()` method SHALL prefix the path with the client's resolved `graphApiVersion` (default `GRAPH_API_VERSION`, override via constructor). Leading slashes on the path argument SHALL be tolerated (one or zero).

#### Scenario: Default version is used in the URL

- **WHEN** a client constructed without `graphApiVersion` calls `request("GET", "/PNID/messages")`
- **THEN** the request URL is `https://graph.facebook.com/v25.0/PNID/messages`

#### Scenario: Custom version override is honoured

- **WHEN** a client constructed with `graphApiVersion: "v23.0"` calls `request("GET", "/PNID/messages")`
- **THEN** the request URL is `https://graph.facebook.com/v23.0/PNID/messages`

#### Scenario: Path without a leading slash is also accepted

- **WHEN** a client calls `request("POST", "PNID/messages", {...})`
- **THEN** the request URL is `https://graph.facebook.com/v25.0/PNID/messages` (no double slash)
