## MODIFIED Requirements

### Requirement: Timing-safe HMAC-SHA256 signature verification

The package SHALL export `verifySignature({ rawBody, signatureHeader, appSecret })` that returns a Promise resolving to `true` if and only if the HMAC-SHA256 of the **raw bytes** of `rawBody` keyed with `appSecret` matches the hex value in `signatureHeader`. Comparison SHALL be timing-safe (a constant-time `Uint8Array` byte-wise compare; no early-exit on first mismatch). The HMAC computation SHALL use `crypto.subtle.sign("HMAC", ...)` so the function runs unmodified on Node ≥ 20, Cloudflare Workers, Bun, Deno, and any WinterCG-compliant runtime. The `sha256=` prefix SHALL be tolerated and stripped. `rawBody` SHALL accept `Buffer | Uint8Array | string`.

#### Scenario: Valid signature returns true

- **WHEN** `signatureHeader === "sha256=" + hmacSha256Hex(appSecret, rawBody)`
- **THEN** `await verifySignature(...)` resolves to `true`

#### Scenario: Tampered body returns false (without throwing)

- **WHEN** the rawBody is altered by one byte after the signature was computed
- **THEN** `await verifySignature(...)` resolves to `false`

#### Scenario: Mismatched `appSecret` returns false

- **WHEN** the signature was computed with one secret but verified with another
- **THEN** `await verifySignature(...)` resolves to `false`

#### Scenario: Missing or malformed header returns false

- **WHEN** `signatureHeader` is `undefined`, `""`, `"sha256="`, `"not-hex"`, or hex of the wrong length
- **THEN** `await verifySignature(...)` resolves to `false` (no throw)

#### Scenario: WebCrypto and node:crypto produce identical digests

- **WHEN** the same `(rawBody, appSecret)` pair is fed to both `crypto.subtle.sign("HMAC", ...)` and `node:crypto.createHmac("sha256", appSecret).update(rawBody).digest()`
- **THEN** the two digest byte arrays are byte-equal

### Requirement: Webhook verify-token handshake

The package SHALL export `verifyHandshake({ mode, verifyToken, challenge, expectedToken })` that returns the `challenge` value when `mode === "subscribe"` AND `verifyToken === expectedToken`. The string compare SHALL be timing-safe via a length-prefix check followed by a constant-time byte-wise compare; the implementation SHALL NOT depend on `node:crypto.timingSafeEqual` so it runs on WinterCG runtimes. Otherwise returns `null`.

#### Scenario: Valid handshake echoes the challenge

- **WHEN** `verifyHandshake({ mode: "subscribe", verifyToken: "abc", challenge: "1234", expectedToken: "abc" })`
- **THEN** the return value is `"1234"`

#### Scenario: Wrong token returns null

- **WHEN** `verifyHandshake({ mode: "subscribe", verifyToken: "wrong", challenge: "1234", expectedToken: "abc" })`
- **THEN** the return value is `null`

#### Scenario: Wrong mode returns null

- **WHEN** `verifyHandshake({ mode: "unsubscribe", verifyToken: "abc", challenge: "1234", expectedToken: "abc" })`
- **THEN** the return value is `null`

#### Scenario: Verify-token compare is timing-safe

- **WHEN** two strings of equal length differ only in the last byte vs. only in the first byte
- **THEN** `verifyHandshake` returns `null` in both cases
- **AND** the runtime of both calls is bounded by the same upper limit (no early-exit data leak)
