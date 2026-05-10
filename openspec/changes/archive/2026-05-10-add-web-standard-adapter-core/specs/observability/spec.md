## MODIFIED Requirements

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
