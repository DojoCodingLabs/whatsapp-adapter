# `@dojocoding/whatsapp` — TypeScript SDK + MCP server for Meta's WhatsApp Cloud API

This repository is a `pnpm` workspace shipping two coordinated
packages:

| Package                                                         | What                                                                                                                                                                                           | npm                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| [`@dojocoding/whatsapp-sdk`](./packages/whatsapp-sdk/README.md) | Typed TypeScript SDK for Meta's WhatsApp Cloud API. Use this when you're building a server that handles webhooks, runs a queue worker, or orchestrates multi-tenant WhatsApp traffic.          | `npm i @dojocoding/whatsapp-sdk`  |
| [`@dojocoding/whatsapp-mcp`](./packages/whatsapp-mcp/README.md) | Model Context Protocol server exposing the SDK's outbound surface to LLM agents. Use this when you're wiring Claude Desktop, the Claude Agent SDK, Cursor, or Cline to send WhatsApp messages. | `npx -y @dojocoding/whatsapp-mcp` |

> **Renamed from `@dojocoding/whatsapp` in `0.8.0`.** See the SDK [`CHANGELOG`](./packages/whatsapp-sdk/CHANGELOG.md) for the one-line migration.

## When to use which?

The full decision tree lives at [`docs/when-to-use-which.md`](./docs/when-to-use-which.md).
The short version:

- **You're building a server that processes WhatsApp webhooks** → SDK alone. Start at [`docs/sdk/quickstart.md`](./docs/sdk/quickstart.md).
- **You're wiring an LLM agent to send WhatsApp messages** → MCP server. Start at [`docs/mcp/quickstart.md`](./docs/mcp/quickstart.md).
- **You're doing both — agent handoff, inbound routing, compliance broadcasts** → both, plus the [`docs/cookbook/hybrid/`](./docs/cookbook/hybrid/) recipes that wire them together. The canonical loop is [`docs/cookbook/hybrid/agent-handoff-loop.md`](./docs/cookbook/hybrid/agent-handoff-loop.md).

The top-level doc index is [`docs/README.md`](./docs/README.md).

## Repo layout

```
.
├── packages/
│   ├── whatsapp-sdk/        # @dojocoding/whatsapp-sdk
│   └── whatsapp-mcp/        # @dojocoding/whatsapp-mcp
├── docs/
│   ├── README.md            # Doc index
│   ├── when-to-use-which.md # Decision tree
│   ├── architecture.md      # System view: SDK + MCP together
│   ├── compliance.md        # WhatsApp policy
│   ├── compatibility.md     # Runtime support
│   ├── sdk/                 # SDK reference (14 pages)
│   ├── mcp/                 # MCP reference (7 pages)
│   └── cookbook/
│       ├── sdk/             # Server-side patterns (7 recipes)
│       ├── mcp/             # Agent-driven patterns (3 recipes)
│       └── hybrid/          # SDK + MCP together (3 recipes)
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
