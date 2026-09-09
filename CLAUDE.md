# CLAUDE.md

This repository is a `pnpm` workspace shipping two coordinated
npm packages:

- **[`@dojocoding/whatsapp-sdk`](./packages/whatsapp-sdk/)** —
  typed TypeScript SDK for Meta's WhatsApp **Cloud API**.
  Modular, spec-driven, opinionated for agentic shapes (LLM
  orchestrators, multi-turn bots, slot-collection flows,
  transactional pipelines, multi-tenant deployments). Not built
  around any single application.
- **[`@dojocoding/whatsapp-mcp`](./packages/whatsapp-mcp/)** —
  Model Context Protocol server that wraps the SDK's outbound
  surface as 19 tools + 2 resources + 1 prompt for LLM agents
  (Claude Desktop, the Claude Agent SDK, Cursor, Cline).

> Before any change, read **[`AGENTS.md`](./AGENTS.md)** for
> invariants, decision rules, and anti-patterns. For SDK
> behaviour, read the relevant
> `openspec/specs/<capability>/spec.md`. For MCP behaviour, read
> [`openspec/specs/mcp-server/spec.md`](./openspec/specs/mcp-server/spec.md).
> For domain rules, read [`docs/compliance.md`](./docs/compliance.md).

## Hard rules in 30 seconds

- **Spec-driven.** Every behaviour change starts as an OpenSpec
  change proposal. Don't write code first.
- **Webhook bodies = raw bytes**, captured before any JSON
  parser. Timing-safe HMAC. Ack 200 within 30 s; handlers async.
- **24-hour customer-service window** is enforced client-side
  via `WindowTracker`. **Only approved templates are
  window-exempt** — reactions and every free-form send are
  gated.
- **Re-engagement gate is Meta error code 131047** →
  `WindowClosedError`. Code 131026 is a distinct "Message
  Undeliverable" condition (recipient not on WhatsApp / outdated
  client / unaccepted ToS) and maps to a separate
  `UndeliverableError` — a template send will NOT recover from 131026.
- **Errors are typed classes** extending `WhatsAppError`. Use
  `instanceof`, not error-code string matching.
- **Zero global state.** One client / receiver / tracker per
  WABA-phone pair. Multi-WABA = multiple instances. The MCP
  server inherits this: one server process per pair.
- **Tests at the right layer.** unit / contract / integration /
  parity — see [`AGENTS.md`](./AGENTS.md) § "Test layers".
- **MCP tools never accept credentials as args.** The model
  could echo them in `content[].text` and leak them. Enforced
  structurally: no tool's `inputSchema` declares a token field.
- **Stdio MCP server logs to stderr only.** Anything on stdout
  outside JSON-RPC frames corrupts the host's parser.

## Common workflows

From the workspace root:

```bash
pnpm install                        # one install covers both packages
pnpm -r typecheck                   # tsc for every package
pnpm -r lint                        # eslint for every package
pnpm format:check                   # prettier across the repo
pnpm -r test                        # vitest for every package
pnpm -r build                       # tsup for every package
pnpm -r size                        # size-limit budgets per package

openspec validate --changes --strict   # before committing a change
openspec archive <change-name>         # after implementation passes
```

The MCP package depends on the SDK's `dist/` types via
`workspace:*` — **build the SDK before typechecking the MCP
package**:

```bash
pnpm --filter @dojocoding/whatsapp-sdk build   # done automatically by CI
```

## Where things are

```
.
├── packages/
│   ├── whatsapp-sdk/        # @dojocoding/whatsapp-sdk (the SDK)
│   │   ├── src/<capability>/    one folder per SDK capability
│   │   └── test/                unit / contract / integration / parity
│   └── whatsapp-mcp/        # @dojocoding/whatsapp-mcp (MCP server)
│       ├── src/
│       │   ├── tools/           one file per MCP tool (19 of them)
│       │   ├── resources/       window + templates resources
│       │   └── prompts/         wa-template-send
│       └── test/                unit + contract (via InMemoryTransport)
├── docs/                    # See docs/README.md for the index
│   ├── sdk/                 # SDK reference (14 pages)
│   ├── mcp/                 # MCP reference (7 pages)
│   └── cookbook/{sdk,mcp,hybrid}/
├── openspec/
│   ├── specs/<capability>/  # 9 stable capabilities (8 SDK + mcp-server)
│   └── changes/             # active proposals + archive
├── AGENTS.md                # Repo-wide invariants and decision rules
└── pnpm-workspace.yaml
```

## Project status

Pre-1.0. The SDK is published as
`@dojocoding/whatsapp-sdk@0.10.x` (renamed from
`@dojocoding/whatsapp` in `0.8.0`; old name deprecated with a
redirect). The MCP server is published as
`@dojocoding/whatsapp-mcp@0.5.x`. The `1.0.0` stability tags are
gated on a live smoke test against a real WABA — see
[`ROADMAP.md`](./ROADMAP.md) § Q4 2026. Pre-1.0 minors may carry
breaking changes; each CHANGELOG entry lists them first.

The most recent compliance pass (Sep 2026 deep audit,
`docs/_internal/2026-09-07-sdk-deep-audit.md`) bumped Graph API
to `v26.0`, realigned the Meta error taxonomy (`131053` →
`CapabilityError`; new `AccountRestrictedError`, `TransientError`,
`NetworkError`, `RequestAbortedError`, `MediaExpiredError`,
`UndeliverableError`), stripped the bearer token from the
`whatsapp.path` span attribute, made `WindowTracker.notifyInbound`
honour the customer's timestamp, added `user_preferences` /
Flows / `request_welcome` webhook parsing, routed media downloads
through the transport, added builder length limits, and surfaced
`StatusEvent.pricingType` for Meta's Oct 1, 2026 per-message
pricing. See [`docs/compliance.md`](./docs/compliance.md) § 3
for the changelog.

## When working on this repo

- **Building a server feature?** Work in `packages/whatsapp-sdk/`.
  Read the relevant `openspec/specs/<capability>/spec.md`.
- **Building an MCP-side feature?** Work in
  `packages/whatsapp-mcp/`. Read
  [`openspec/specs/mcp-server/spec.md`](./openspec/specs/mcp-server/spec.md).
- **Doc-only change?** No OpenSpec needed. Update the relevant
  page under `docs/` and the per-package `README.md` if it's a
  tarball-shipped front door.
- **Cross-cutting (the two packages interact in some new way)?**
  Touches `docs/architecture.md` and likely
  `docs/cookbook/hybrid/`. Often also touches the SDK's
  `WhatsAppLikeClient` interface (the integration point).
