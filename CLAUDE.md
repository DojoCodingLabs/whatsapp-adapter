# CLAUDE.md

This is `@dojocoding/whatsapp` — a typed TypeScript SDK that wraps
Meta's WhatsApp **Cloud API** for the Dojo Coding agentic front-desk
platform.

> Before any change, read **[`AGENTS.md`](./AGENTS.md)** for invariants,
> decision rules, and anti-patterns. Read the relevant
> `openspec/specs/<capability>/spec.md` for normative behaviour, and
> `docs/compliance.md` for the domain rules this SDK enforces.

## Hard rules in 30 seconds

- **Spec-driven.** Every behaviour change starts as an OpenSpec change
  proposal. Don't write code first.
- **Webhook bodies = raw bytes**, captured before any JSON parser.
  Timing-safe HMAC. Ack 200 within 30 s; handlers async.
- **24-hour customer-service window** is enforced client-side via
  `WindowTracker`. Templates and reactions are window-exempt.
- **Errors are typed classes** extending `WhatsAppError`. Use
  `instanceof`, not error-code string matching.
- **Zero global state.** One client / receiver / tracker per WABA-phone
  pair. Multi-WABA = multiple instances.
- **Tests at the right layer.** unit / contract / integration / parity
  — see `AGENTS.md` § "Test layers".

## Common workflows

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
openspec validate --changes --strict   # before committing a change
openspec archive <change-name>         # after implementation passes
```

## Where things are

- Source: `src/<capability>/` — one folder per capability.
- Specs: `openspec/specs/<capability>/spec.md` — eight of them.
- Active changes: `openspec/changes/<name>/`. Archived (merged) under
  `openspec/changes/archive/`.
- Docs (humans): `docs/<capability>.md` plus `docs/quickstart.md`,
  `docs/architecture.md`, `docs/compliance.md`,
  `docs/compatibility.md`.
- Docs (agents): this file, `AGENTS.md`, `docs/patterns.md`,
  `docs/cookbook/`.

## Project status

Pre-alpha. Public API stable enough for internal consumers; minor
breaking changes can land between OpenSpec archives. Status will move
to `0.1` once the parent project (Dojo Front Desk) ships v1.

The most recent compliance pass (May 2026) bumped Graph API to
`v25.0`, widened webhook dedupe TTL to 24 h, added
`AuthenticationError` / `PermissionError` / `CapabilityError` typed
classes, and added an optional template registry to
`MockWhatsAppClient`. See
[`docs/compliance.md`](./docs/compliance.md) § 3 for the changelog.
