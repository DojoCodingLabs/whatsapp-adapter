# Security policy

`@dojocoding/whatsapp` handles bearer tokens, Meta App Secrets, HMAC
verification, and inbound user content. Treat any defect that affects those
boundaries as security-relevant.

## Reporting a vulnerability

Email **security@dojocoding.com** with:

- A description of the issue
- A minimal reproduction, ideally a failing test
- The package version (`pnpm list @dojocoding/whatsapp` or the commit SHA)
- Whether the issue is currently being exploited (yes / no / unknown)

Do **not** open a public issue or PR for security reports. We aim to
acknowledge within two business days.

GitHub's
[private vulnerability reporting](https://github.com/DojoCodingLabs/whatsapp-adapter/security/advisories/new)
is also enabled on this repository if you prefer that channel.

## What this SDK promises

The package is structured to make a few correctness guarantees that matter
for security:

- **Errors never carry credential values.** `MissingCredentialsError` names
  the missing field but never includes the supplied (or absent) token /
  secret. This is enforced by a unit test
  (`test/unit/types/errors.test.ts`); breaking it is a regression.
- **Webhook signatures are verified in constant time.** `verifySignature`
  uses Node's `crypto.timingSafeEqual` over equal-length buffers and
  short-circuits on length / hex-shape mismatches without leaking which
  branch failed.
- **Verify-token handshake is also constant-time.** `verifyHandshake` only
  calls `timingSafeEqual` after confirming the buffer lengths are equal,
  preventing a length oracle.
- **PII redaction on observability spans.** Phone-number ids are hashed via
  `hashPhoneNumberId` before they appear as span attributes. The salt is
  configurable per-environment via `setRedactSalt(...)`.
- **Raw webhook bodies are captured before any JSON parser.** The Express
  middleware uses `express.raw({ type: "application/json" })` internally so
  the bytes used for HMAC verification are byte-identical to what Meta
  sent.

## What you (the consumer) must enforce

The SDK can't enforce these from inside; they're your responsibility:

1. **Set `setRedactSalt(salt)` once at boot to a per-environment value.**
   The default salt is shared across processes and environments; using it
   in production is fine for redaction but defeats span-correlation
   isolation between environments.
2. **Rotate the App Secret on suspicion.** A systemic spike in 401 webhook
   responses (signature mismatch) can mean either Meta-side delivery
   problems or a leaked App Secret. Rotate before assuming the former.
3. **Don't log raw webhook bodies.** They contain user message text. The
   SDK's spans never log bodies; if you log inbound events yourself, narrow
   to the fields you actually need.
4. **Don't register `express.json()` before the WhatsApp middleware.** The
   middleware captures raw bytes for HMAC. A global JSON parser registered
   earlier will consume the stream and signatures will fail (you'll see
   `401`s, not silent corruption — but it's still wrong by design).
5. **Treat the verify token as a secret.** It's the only thing protecting
   the `GET /webhook` endpoint from arbitrary callers; rotate by updating
   both Meta's webhook UI and your env at the same moment.
6. **Don't cache Meta's media-download URLs.** They expire ≈ 5 minutes
   after issue. The SDK doesn't currently auto-refresh; download-and-store
   is on you.

## Threat model out of scope

These are explicitly **not** what this SDK defends against:

- Theft of credentials at rest (use a secret manager).
- Compromised hosts running the SDK (OS-level concerns).
- Man-in-the-middle attacks on the HTTPS connection to `graph.facebook.com`
  (TLS is the OS / Node / fetch layer's responsibility).
- Misuse of approved templates to send unsolicited marketing — that's a
  Meta policy concern, not a code concern.
- Phone-number / WABA permission boundaries — the SDK accepts whatever the
  bearer token has access to; granting that token correctly is a Business
  Manager configuration concern.

## Coordinated disclosure

If you find a vulnerability that also affects WhatsApp Business Platform
itself (rather than just this wrapper), report to **Meta** via
[their bug-bounty program](https://www.facebook.com/whitehat/) and let us
know separately so we can patch our wrapper without front-running the
upstream fix.
