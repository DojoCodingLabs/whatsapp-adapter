# `@dojocoding/whatsapp` — TypeScript SDK + MCP server for Meta's WhatsApp Cloud API

This repository is a `pnpm` workspace shipping two coordinated
packages:

| Package                                                         | What                                                                                                                                                                                           | npm                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| [`@dojocoding/whatsapp-sdk`](./packages/whatsapp-sdk/README.md) | Typed TypeScript SDK for Meta's WhatsApp Cloud API. Use this when you're building a server that handles webhooks, runs a queue worker, or orchestrates multi-tenant WhatsApp traffic.          | `npm i @dojocoding/whatsapp-sdk`  |
| [`@dojocoding/whatsapp-mcp`](./packages/whatsapp-mcp/README.md) | Model Context Protocol server exposing the SDK's outbound surface to LLM agents. Use this when you're wiring Claude Desktop, the Claude Agent SDK, Cursor, or Cline to send WhatsApp messages. | `npx -y @dojocoding/whatsapp-mcp` |

> **Renamed from `@dojocoding/whatsapp` in `0.8.0`.** See the SDK [`CHANGELOG`](./packages/whatsapp-sdk/CHANGELOG.md) for the one-line migration.

## When to use which?

The full decision tree lives at [`docs/when-to-use-which.md`](./docs/when-to-use-which.md) (landing in Phase C3 of the
[mcp-server OpenSpec change](./openspec/changes/2026-05-10-add-mcp-server/)).
The short version:

- **You're building a server that processes WhatsApp webhooks** → SDK alone.
- **You're wiring an LLM agent to send WhatsApp messages** → MCP server.
- **You're doing both — agent handoff, inbound routing, compliance broadcasts** → both, plus the [`docs/cookbook/hybrid/`](./docs/cookbook/hybrid/) recipes that show how to wire them together.

## Repo layout

```
.
├── packages/
│   ├── whatsapp-sdk/        # @dojocoding/whatsapp-sdk
│   └── whatsapp-mcp/        # @dojocoding/whatsapp-mcp
├── docs/                    # See docs/README.md (Phase C3) for the index
│   ├── sdk/                 # SDK reference
│   ├── mcp/                 # MCP reference (Phase C3)
│   ├── cookbook/
│   │   ├── sdk/             # Server-side patterns
│   │   ├── mcp/             # Agent-driven patterns (Phase C3)
│   │   └── hybrid/          # SDK + MCP together (Phase C3)
│   ├── architecture.md
│   ├── compliance.md
│   └── compatibility.md
├── openspec/                # Spec-driven change proposals
├── AGENTS.md                # Repo-wide invariants
├── CLAUDE.md                # AI-assistant onboarding
└── pnpm-workspace.yaml
```

## Status

Pre-1.0. The SDK has shipped 13 releases under the old name
(`@dojocoding/whatsapp@0.1.0`–`0.7.4`) and continues as
`@dojocoding/whatsapp-sdk@0.8.0+`. The MCP server launches at
`@dojocoding/whatsapp-mcp@0.1.0` with the surface defined in
[OpenSpec change 2026-05-10-add-mcp-server](./openspec/changes/2026-05-10-add-mcp-server/).

## Develop locally

```bash
pnpm install                # one install at workspace root covers both packages
pnpm -r typecheck           # typecheck every package
pnpm -r lint                # lint every package
pnpm -r test                # vitest in every package
pnpm -r build               # tsup in every package
pnpm -r size                # size-limit budgets across both
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full development
discipline, OpenSpec workflow, and release process.
