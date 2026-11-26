# Change proposal — realign the Meta error taxonomy (Nov 2026) and key throughput per phone number

Affected capabilities: `cloud-api-client` (error mapper, transport
5xx path) and `outbound-queue` (`withRateLimit` throughput bucket).

## Why

The Nov 2026 platform audit compared `mapMetaError` with Meta's
current error-code reference
(`/documentation/business-messaging/whatsapp/support/error-codes`)
and the Marketing Messages changelog. It found these gaps:

- Live failure modes fall through to `UNKNOWN`. Since Oct 1, 2026,
  `131042` (payment method) stops service messages on unbilled
  WABAs. Also unmapped: `130403` (business blocked the user),
  `131021`, `131063`, `131065`, and the phone-number configuration
  codes `33`, `131037`, `131045`, `133010`.
- `131066` replaces `131049` from March 2027 but is unmapped.
- Meta's "temporary — try again" codes (`1`, `2`, `131000`,
  `131016`, `131057`, `133004`, `2494100`) are not retried on a 4xx,
  and lose their code on a 5xx.
- `131048` (spam rate limit) is retried four times in-call. Meta
  treats it as a quality restriction ("check your quality status"),
  so each retry adds another flagged send.
- Meta documents `200` as "No access token provided", which is not a
  permission error. Most of the `200`–`299` permission range is
  unmapped.
- The transport turns every 5xx into `TransientHttpError` before it
  reads the body. A permanent code on HTTP 500 (`134102`, template
  unavailable) is retried four times and surfaces as `TransientError`.
- Meta's 80 MPS throughput limit applies "per registered business
  phone number" and includes inbound traffic. The queue names and
  keys this bucket per WABA.
- Docs drift: `openspec/config.yaml` still says v23.0, cites 131026
  for the window and lists the MCP wrapper as out of scope. The
  issue template says v25.0. The outbound cookbook says 131026 →
  `WindowClosedError`. `compliance.md` has a stale "coverage partial"
  note, future-tense pricing text, and the legacy error-code URL.

## What Changes

- `mapMetaError`: new mappings for the codes above. Every new
  mapping is non-retryable except the temporary codes, which become
  `TransientError({ metaCode })` and are retried by the existing
  `DEFAULT_RETRY_POLICY`. `131048` moves to the non-retryable
  `RateLimitError` set. `200` → `AuthenticationError`; `201`–`299` →
  `PermissionError` (range check). `134102` → `TemplateError`.
- `UndeliverableError` gains `metaCode` and `reason`
  (`UNREACHABLE` | `RECIPIENT_BLOCKED`). `TransientError` gains
  `metaCode`. New `isTransientMetaCode(code)` helper (internal).
- Transport: when the body of a 408 / 429 / 5xx is a Meta envelope,
  it is mapped first. A non-retryable typed result is thrown on the
  first attempt; anything else keeps the current transient retry
  behaviour.
- `withRateLimit`: new `perPhone` option, bucket keyed by
  `phoneNumberId`. `perWaba` stays as a deprecated alias.
- Docs: `openspec/config.yaml`, `compliance_drift.yml`,
  `outbound-only.md`, `compliance.md` (§ 2 pricing, § 3.3, § 4, new
  § 4.1 "Known upcoming platform changes"), `docs/sdk/client.md`,
  `docs/sdk/queue.md`.

## Non-goals

- A Marketing Messages API endpoint. The codes only it returns
  (`131055`, `134100`, `134101`) stay `UNKNOWN`.
- `messagingAccountId` support and `pricing.subtype` parsing. These
  are documented as upcoming changes only.
- MCP recovery-hint changes for `131048`, `131066`, `130403` (owned
  by the MCP package).
- Changing retry timing or `DEFAULT_RETRY_POLICY`.

## Impact

- `cloud-api-client`: one MODIFIED requirement (the mapper) and one
  ADDED requirement (envelope-first 5xx handling).
- `outbound-queue`: one MODIFIED requirement (`withRateLimit`).
- These are behaviour changes for consumers that branch on `131048`
  retries or on `PermissionError` for `200`, so the next release is a
  minor bump. They are listed under `### Breaking` in the CHANGELOG.
