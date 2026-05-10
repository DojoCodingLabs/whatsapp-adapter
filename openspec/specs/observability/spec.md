# observability Specification

## Purpose
TBD - created by archiving change add-otel-instrumentation. Update Purpose after archive.
## Requirements
### Requirement: withSpan async wrapper
The package SHALL export `withSpan(name, fn, attributes?)` that creates an OpenTelemetry span around an async `fn`, applies any provided `attributes` at start time, records exceptions thrown by `fn`, sets `SpanStatusCode.ERROR` on failure (with the error message), and ends the span when `fn` resolves or rejects. The wrapper SHALL return whatever `fn` resolves with.

#### Scenario: Successful fn produces a span with status OK
- **WHEN** `await withSpan("test.op", async () => "result")` is called inside an OTel test harness
- **THEN** the resolved value is `"result"`
- **AND** an exporter records exactly one span named `"test.op"` with `kind: SpanKind.INTERNAL`
- **AND** the span's status code is `OK` (or unset, per OTel default)

#### Scenario: Throwing fn records exception and sets ERROR status
- **WHEN** `withSpan("op.fail", async () => { throw new Error("boom") })` is awaited
- **THEN** the call rejects with the same error
- **AND** an exporter records the span with `status.code === SpanStatusCode.ERROR`
- **AND** the span has at least one event with `name === "exception"`

#### Scenario: Attributes applied at start are preserved on the span
- **WHEN** `withSpan("op", fn, { "whatsapp.foo": "bar" })` is called
- **THEN** the recorded span has `attributes["whatsapp.foo"] === "bar"`

### Requirement: hashPhoneNumberId never returns the raw id

`hashPhoneNumberId(phoneNumberId)` SHALL return a Promise resolving to a stable lowercase-hex string of length 16 derived from the SHA-256 of the salt plus the input. Repeated calls with the same input and salt SHALL resolve to the same value. The output SHALL NOT contain any contiguous substring of the input (length ≥ 4) — i.e., the function does not pass the id through verbatim. The SHA-256 computation SHALL use `crypto.subtle.digest("SHA-256", ...)` so the function runs unmodified on Node ≥ 20, Cloudflare Workers, Bun, Deno, and any WinterCG-compliant runtime.

#### Scenario: Stable across calls

- **WHEN** `await hashPhoneNumberId("PHONE_ID_12345")` is called twice in the same process
- **THEN** both calls resolve to the same 16-character hex string

#### Scenario: Differs from raw input

- **WHEN** `const h = await hashPhoneNumberId("PHONE_ID_12345")`
- **THEN** `h !== "PHONE_ID_12345"`
- **AND** `h.length === 16`
- **AND** `/^[0-9a-f]{16}$/.test(h)`

#### Scenario: Different inputs produce different outputs (with overwhelming probability)

- **WHEN** `await hashPhoneNumberId("A")` and `await hashPhoneNumberId("B")` are awaited
- **THEN** the two return values differ

#### Scenario: WebCrypto and node:crypto produce identical digests

- **WHEN** the same `(salt + input)` is fed to both `crypto.subtle.digest("SHA-256", ...)` and `node:crypto.createHash("sha256").update(...).digest()`
- **THEN** the two digest byte arrays are byte-equal (and therefore the first 8 bytes — 16 hex chars — are identical)

### Requirement: No-op when no tracer provider is registered
When the OTel API has no global tracer provider registered (the default), `withSpan` SHALL still execute `fn` and return its result correctly. No errors SHALL be raised due to absent OTel SDK setup. The default OTel API tracer is a no-op; this requirement guarantees we never do something that breaks with a no-op.

#### Scenario: withSpan works with no tracer registered
- **WHEN** the test harness explicitly clears any registered provider and `await withSpan("op", async () => 42)` is called
- **THEN** the resolved value is `42` and no exception is thrown

