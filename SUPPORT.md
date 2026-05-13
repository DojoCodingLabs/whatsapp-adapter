# Support policy

This document defines the **support window** for each major
release of `@dojocoding/whatsapp-sdk` and
`@dojocoding/whatsapp-mcp`.

## Versioning recap

Both packages follow [Semantic Versioning](https://semver.org).
The current state:

- **Pre-1.0** — minor versions may contain breaking changes.
  Each minor is documented in the per-package
  [`CHANGELOG`](./packages/whatsapp-sdk/CHANGELOG.md) with
  explicit `BREAKING` markers.
- **Post-1.0** — strict semver. Breaking changes require a
  major bump. Deprecations land in a minor (`@deprecated`
  JSDoc) before removal in the next major.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) § Releases for the
versioning policy in detail.

## Support window — each major

| Major                | Status                         | Security patches | Bug fixes                              |
| -------------------- | ------------------------------ | ---------------- | -------------------------------------- |
| `1.x`                | **Current** (when 1.0.0 ships) | Yes              | Yes                                    |
| `0.x` (pre-1.0)      | Stabilising                    | Best effort      | Best effort                            |
| `<previous major>.x` | After `next-major.0.0` ships   | 12 months        | None (no new bug fixes; security only) |

In plain terms: when `2.0.0` ships, the `1.x` line gets
security patches for 12 more months but no new bug fixes or
features. Consumers SHOULD migrate to `2.x` within that
window.

## What "security patch" means

A security patch is a release that addresses any of:

- A vulnerability disclosed via [`SECURITY.md`](./SECURITY.md)'s
  reporting flow with CVSS ≥ 4 (Medium or higher).
- A confirmed credential-leak path (token in span attribute,
  log line, error message, etc.).
- A confirmed protocol-level vulnerability (HMAC bypass,
  signature-forgery, etc.).

Security patches land as `<previous-major>.x.y+1` patch
releases. The CHANGELOG entry calls out the security fix
explicitly with the affected versions, the CVSS score, and a
remediation summary.

## What "bug fix" means (current major only)

Any release that:

- Restores documented behaviour that regressed.
- Closes a gap in OpenSpec-stated requirements.
- Addresses a CI / dependency-update flake.

Bug fixes land as `<current-major>.<current-minor>.z+1` patch
releases.

## Deprecation cadence

A symbol marked `@deprecated` in version `X.minor`:

- **Remains functional through the entire `X.*` line.**
- Removed in `X+1.0.0` at the earliest.

This gives consumers a full major's worth of releases to
migrate. Migration paths are documented in
[`MIGRATION.md`](./MIGRATION.md).

Examples in flight (as of `sdk-v0.9.0`):

- `setRedactSalt(...)` — deprecated in `0.8.3`. Replaced by
  the per-client `redactSalt` option. Will be removed in
  `sdk-v2.0.0` at the earliest (after `1.x` ships).

## End-of-life process

When a major reaches end of its 12-month security-patch
window:

1. A notice lands in `CHANGELOG.md` at the major's
   `<major>.x` final-release entry.
2. The npm `dist-tags` for that major are NOT removed —
   `npm install @dojocoding/whatsapp-sdk@1.x` keeps working
   indefinitely; only new patches stop.
3. The `<major>.x.x` branch is archived in the GitHub
   repository (read-only).

Consumers on an end-of-life major see no functional change —
their pinned version keeps installing — but they accumulate
unpatched security risk until they migrate.

## How to check what major you're on

```bash
npm ls @dojocoding/whatsapp-sdk
npm ls @dojocoding/whatsapp-mcp
```

Or check `package.json`. If you're more than one major
behind the current release, schedule a migration sprint.

## Reporting security issues

See [`SECURITY.md`](./SECURITY.md) for the reporting flow.
Do NOT open public GitHub issues for vulnerabilities — use
the private channel listed there.

## Asking for help

Bug reports, feature requests, and general support:
[GitHub Issues](https://github.com/DojoCodingLabs/whatsapp-adapter/issues).

Issues are triaged within ~3 business days. Production-blocking
issues (deployed consumers seeing breakage in a published
version) are prioritised over feature requests.

## What we don't do

- **Free per-deployment troubleshooting.** Generic
  "this doesn't work on my Vercel instance" without a
  minimal reproduction lives at the bottom of the queue.
  Reproductions land much faster than vague reports.
- **Backported features.** New features only land on the
  current major. The previous major gets bug fixes + security
  only.
- **Custom integrations.** Adapters, custom transports, and
  bespoke storage backends live in consumer codebases. The
  cookbook demonstrates the patterns; the implementation is
  per-deployment.

## See also

- [`SECURITY.md`](./SECURITY.md) — vulnerability reporting flow.
- [`MIGRATION.md`](./MIGRATION.md) — upgrade paths between majors.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) § Releases — the
  release / tag / publish workflow.
- [`ROADMAP.md`](./ROADMAP.md) — quarter-level targets for
  the next major.
