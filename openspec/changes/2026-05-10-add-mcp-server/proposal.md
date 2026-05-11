## Why

`@dojocoding/whatsapp` ships with everything an application needs to
talk to Meta's WhatsApp Cloud API — typed sends, template registry,
window tracker, webhook receiver, storage adapters, framework
adapters. **What it doesn't ship is a way to put that surface in
front of an LLM agent.** A user who wants Claude Desktop or a
Claude-Agent-SDK runtime to send WhatsApp messages today has to
write a bespoke Model Context Protocol server around our SDK.

This change adds that server as a first-class shipped artefact:
**a new npm package `@dojocoding/whatsapp-mcp`**, sibling to
`@dojocoding/whatsapp-sdk` (the renamed existing SDK), that
wraps the SDK's outbound surface as an MCP server.

This proposal also folds in two coupled changes that must happen
in the same atomic step:

- **Renaming the existing `@dojocoding/whatsapp` to
  `@dojocoding/whatsapp-sdk`.** Symmetrical naming with the new
  MCP sibling — "SDK + MCP" reads cleanly in docs, the npm search
  page, and `claude_desktop_config.json` callouts. Pre-1.0 is
  the right moment; the SDK has 13 published versions but
  vanishingly low adoption since the first release shipped
  yesterday. The old name gets a deprecation banner pointing at
  the new one.
- **Reorganising the docs tree** under a single repo-root
  `docs/` with `docs/sdk/`, `docs/mcp/`, `docs/cookbook/{sdk,mcp,hybrid}/`
  subtrees. The `docs/cookbook/hybrid/` folder is the showcase
  for the strongest production pattern (agent sends an outbound
  template via MCP; consumer's app receives the reply via SDK
  webhook receiver; consumer routes the reply back into the
  agent's runtime). The complementary relationship between the
  two packages is surfaced in three load-bearing places: the
  root README, a new `docs/when-to-use-which.md` decision-tree
  doc, and a "sibling package" callout at the top of each
  package's README.

Two precedents pinned the design:

- **The Slack and GitHub MCP servers are pure outbound.** They
  expose pull-based reads (`slack_get_channel_history`,
  `github_list_pull_request_comments?since=…`) but no webhook
  ingestion. The vendor's history API is the substitute for
  push-stream subscriptions, because MCP's request/response tool
  model doesn't have a first-class primitive for async pushes that
  every client supports today (Resource subscriptions exist but
  Claude Desktop ignores them; the experimental Tasks primitive
  in spec `2025-11-25` ships unevenly).
- **WhatsApp Cloud API has no message-history endpoint.** Meta
  delivers inbound exactly once via webhook. Our `Storage`
  interface is key-value with no iteration primitive — `get` /
  `set` / `setIfAbsent` / `delete` only. A `whatsapp_list_recent_inbound`
  tool is structurally impossible against the current `Storage`
  shape, which is another reason inbound stays out of v1.

So v1 is **outbound-only**: every `WhatsAppClient.sendX(...)`
method becomes one MCP tool, the template registry reads become
two more, and the window tracker becomes one resource. Inbound
remains in the consumer's app via `WebhookReceiver`, which is
already well-covered by the SDK's existing webhook capability.

This is also the right moment to convert the repo into a pnpm
workspace. The MCP server pulls `@modelcontextprotocol/sdk` and
`zod-to-json-schema` as runtime deps — making them deps of the
SDK proper would force every SDK consumer to install
~hundreds of KB of MCP machinery they never use. Sibling
packages keep the SDK's surface lean and let the MCP server
version independently.

## What Changes

### Repo layout — workspace refactor + SDK rename (Phase C0, ships `@dojocoding/whatsapp-sdk@0.8.0`)

- **NEW** root `pnpm-workspace.yaml` declaring `packages/*`.
- **RENAMED** `@dojocoding/whatsapp` → `@dojocoding/whatsapp-sdk`.
  All source code, tests, and behaviour preserved verbatim; only
  the npm package name and folder name change.
- **NEW** `packages/whatsapp-sdk/` containing the renamed SDK
  (move `src/`, `test/`, `dist/`, `tsup.config.ts`,
  `vitest.config.ts`, the SDK's `package.json` and `CHANGELOG.md`)
  with **zero runtime behaviour change**. Version bumps to
  `0.8.0` to mark the rename milestone.
- **NEW** `packages/whatsapp-mcp/` skeleton (empty `src/`,
  bootstrap `package.json` at version `0.1.0`, own
  `tsup.config.ts`, own `vitest.config.ts`).
- **DEPRECATED** the npm name `@dojocoding/whatsapp` via
  `npm deprecate @dojocoding/whatsapp@"*" "Renamed to @dojocoding/whatsapp-sdk — install that package instead."`.
  The 13 published versions (0.1.0–0.7.4) stay on npm
  (immutable per registry policy), pinned consumers keep
  working, new installs see the deprecation banner.
- **MODIFIED** root `package.json` becomes a workspace root (no
  publishable code; just devDependencies for shared tooling like
  eslint, prettier, typescript, lint-staged, simple-git-hooks,
  size-limit).
- **MODIFIED** `.github/workflows/{ci,release,openspec,codeql}.yml`
  to operate over both packages. CI matrix runs lint, typecheck,
  test, build, size for each. Release workflow detects which
  package the pushed tag belongs to via tag-prefix convention:

  | Tag prefix | Package | Working dir |
  | ---------- | ------- | ----------- |
  | `sdk-v0.x.x` | `@dojocoding/whatsapp-sdk` | `packages/whatsapp-sdk/` |
  | `mcp-v0.x.x` | `@dojocoding/whatsapp-mcp` | `packages/whatsapp-mcp/` |

  Both prefixes are new; the old `v0.x.x` tag pattern retires
  with the SDK rename.
- **MODIFIED** `.github/dependabot.yml` adds a second
  `package-ecosystem: npm` block for `packages/whatsapp-mcp/`.
- **MODIFIED** `size-limit` config: SDK keeps its 7 budgets
  (re-rooted to `packages/whatsapp-sdk/dist/...`); MCP adds two
  budgets for `cli.js` and `index.js` (~250 KB each).
- **MODIFIED** root `tsconfig.json` becomes a references
  project pointing at the two packages.
- **PRESERVED** every existing `@dojocoding/whatsapp` public
  export, behaviour, and test. The 572 SDK tests pass unchanged
  after the rename. Consumers' code that does
  `import {…} from "@dojocoding/whatsapp"` updates the package
  name once in `package.json`; the import shape is identical.

### Docs reorganisation (Phase C0 mechanical move + Phase C3 fill-out)

The existing `docs/` (SDK-only) moves under `docs/sdk/` as a
mechanical rename in Phase C0; new MCP docs and cookbook
recipes land in Phase C3. Final shape:

```
docs/
├── README.md                       # Doc index, "pick your starting point"
├── when-to-use-which.md            # ★ Decision tree (SDK vs MCP vs both)
├── architecture.md                 # System view: how SDK + MCP fit together
├── compliance.md                   # WhatsApp policy (cross-cutting)
├── compatibility.md                # Runtime support (cross-cutting)
├── sdk/                            # SDK-specific reference (existing docs, moved)
│   ├── quickstart.md, client.md, webhooks.md, window.md,
│   │   messages.md, templates.md, storage.md, queue.md,
│   │   observability.md, mock.md, express.md, web.md, hono.md,
│   │   patterns.md
├── mcp/                            # NEW — MCP-specific reference
│   ├── quickstart.md               # Claude Desktop in 5 minutes
│   ├── tools.md                    # All 16 tools, when to use each
│   ├── resources.md, prompts.md, auth.md
│   ├── error-recovery.md           # Recovery-hint catalogue
│   └── transports.md               # stdio today, HTTP future
└── cookbook/                       # Walkthroughs
    ├── README.md
    ├── sdk/                        # Existing recipes, moved
    │   ├── inbound-auto-responder.md, two-way-support-with-handoff.md,
    │   │   transactional-notification.md, appointment-booking.md,
    │   │   multi-tenant.md, cloudflare-workers.md, hono.md
    ├── mcp/                        # NEW — agent-driven patterns
    │   ├── claude-desktop.md, claude-agent-sdk.md,
    │   │   multi-server-claude-desktop.md
    └── hybrid/                     # ★ SDK + MCP together (the showcase)
        ├── agent-handoff-loop.md, inbound-routed-to-agent.md,
        │   compliance-broadcast.md
```

Each package ships a short README inside its tarball (install +
30-line example + Claude-Desktop config for MCP + link to live
docs). The full docs tree lives on GitHub and is the single
source of truth.

### MCP server — capability surface (Phase C1 + C2, ships `@dojocoding/whatsapp-mcp@0.1.0` then `0.2.0`)

- **NEW** capability `mcp-server` with full spec under
  `openspec/specs/mcp-server/spec.md`.
- **NEW** package `@dojocoding/whatsapp-mcp` exposing:
  - **Default subpath** `import { WhatsAppMcpServer } from "@dojocoding/whatsapp-mcp"` — programmatic embedding.
  - **Bin** `dojo-whatsapp-mcp` — runnable via `npx -y @dojocoding/whatsapp-mcp`. Invoked by Claude Desktop / Cursor / Cline through standard `claude_desktop_config.json` shape.
- **NEW** 16 outbound tools (full list in spec):
  - 13 send tools (text, image, video, audio, voice, document,
    location, contacts, interactive_buttons, interactive_list,
    template, auth_template, carousel_template)
  - 1 reaction tool
  - 2 template-registry reads (list, get)
- **NEW** 2 MCP resources:
  - `whatsapp://window/{phone}` — current 24-h-window state
    (open / closed, expires-at) for a given recipient.
  - `whatsapp://templates` — list of approved templates with
    metadata.
- **NEW** 1 MCP prompt:
  - `wa-template-send` — guided slash-command that asks the user
    for template name + variables and emits the corresponding
    `whatsapp_send_template` tool call. Surfaces in Claude
    Desktop's slash-command picker.
- **NEW** auth contract: env vars
  (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, optional
  `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_API_VERSION`), CLI
  flag fallback, **never via tool arguments**.
- **NEW** error mapping: SDK's typed `WhatsAppError` hierarchy
  maps to `{ content, isError: true, structuredContent }` so the
  LLM can recover; protocol / programmer errors throw plain
  `Error`.
- **NEW** runtime deps: `@modelcontextprotocol/sdk ^1.29`,
  `zod-to-json-schema ^3.23`, `@dojocoding/whatsapp-sdk`
  (workspace link in dev, fixed range at publish).
- **NEW** tests: unit (per-tool input schema), contract (in-memory
  MCP transport drives a server backed by `MockWhatsAppClient`
  and asserts every tool's structuredContent), one E2E
  (`WHATSAPP_MCP_E2E=1` gated) that spawns the bin and round-trips
  JSON-RPC over stdio.
- **NEW** size budget for the MCP CLI bundle.

### Docs deep fill-out (Phase C3, ships `@dojocoding/whatsapp-mcp@0.2.1`)

- **NEW** `packages/whatsapp-mcp/README.md` — tarball-shipped
  install + Claude Desktop config + 30-line example + link to
  live docs.
- **NEW** `packages/whatsapp-sdk/README.md` — updated SDK README
  with "sibling package" callout pointing at whatsapp-mcp.
- **NEW** `docs/README.md` — doc index with three entry points
  ("I'm building a server" → SDK, "I'm building an agent" → MCP,
  "Both" → hybrid cookbook).
- **NEW** `docs/when-to-use-which.md` — decision tree.
- **NEW** `docs/mcp/` (six pages): `quickstart.md`, `tools.md`,
  `resources.md`, `prompts.md`, `auth.md`, `error-recovery.md`,
  `transports.md`.
- **NEW** `docs/cookbook/mcp/` (three recipes):
  `claude-desktop.md`, `claude-agent-sdk.md`,
  `multi-server-claude-desktop.md`.
- **NEW** `docs/cookbook/hybrid/` (three recipes, the showcase):
  `agent-handoff-loop.md`, `inbound-routed-to-agent.md`,
  `compliance-broadcast.md`.
- **MODIFIED** root `README.md`: two-package overview with
  ASCII diagram + capabilities table side by side.
- **MODIFIED** `docs/architecture.md`: extends to cover the
  system view (how SDK + MCP fit together).

## Capabilities

### Modified Capabilities

None. The MCP server is a new top-level capability; it does not
change any existing spec's normative requirements. It depends on
`cloud-api-client`, `message-builders`, and `template-management`
but does not modify them.

### New Capabilities

- `mcp-server` (full spec at
  `openspec/specs/mcp-server/spec.md`) — the protocol contract
  for the MCP server's tool/resource/prompt surface, auth,
  transport, and error mapping.

## Non-goals

- **Inbound webhook surface through MCP.** No `wait_for_inbound`,
  no resource subscriptions, no `list_recent_inbound`. Inbound
  stays in the consumer's app via `WebhookReceiver`. If/when
  `Storage` grows iteration primitives (a separate, larger
  proposal) and the MCP `Tasks` primitive ships across clients,
  revisit in v2.
- **Streamable HTTP / remote MCP hosting.** stdio transport only
  for v1. Hosting `wa-mcp.dojocoding.com` is a separate proposal
  with its own auth (OAuth resource-server pattern) and
  multi-tenancy concerns.
- **Media upload through tool args.** Tools accept `link:` (public
  URL) only. The LLM cannot produce raw bytes; expecting it to
  base64-encode a video is pathological. If you need to upload,
  use the SDK's `client.uploadMedia()` (still SDK-only).
- **Sticker / reply / mark-as-read tools.** Sticker has minimal
  agentic value; reply needs an `inReplyTo` wamid only available
  in inbound context; mark-as-read only useful when wired to
  inbound stream — all three deferred with inbound.
- **Per-call credentials / multi-WABA over MCP.** Each MCP server
  instance binds to a single WABA-phone pair via env vars. A
  multi-tenant agent runs N MCP-server processes — matches the
  SDK's "one instance per pair" invariant.
- **`@stripe/agent-toolkit`-style permission filtering in v1.** A
  `--readonly` mode is a clean v1.1 add; v1 ships full surface.

## Impact

- **Public API surface of the SDK:** zero runtime change. The
  package is renamed from `@dojocoding/whatsapp` to
  `@dojocoding/whatsapp-sdk`. Consumers update `package.json`
  once (`"@dojocoding/whatsapp": "^0.7.0"` →
  `"@dojocoding/whatsapp-sdk": "^0.8.0"`); every `import` line
  inside their code rebases via find-and-replace on the package
  name. No symbol renames, no type changes, no behaviour change.
- **New public API** under `@dojocoding/whatsapp-mcp` —
  greenfield, no compatibility surface.
- **Old npm name (`@dojocoding/whatsapp`):** the 13 published
  versions stay live (registry immutability); the name is
  marked `deprecate` with a redirect message. No new versions
  publish under it. Pinned consumers keep working forever; new
  installs see the deprecation banner.
- **Repo structure:** files move from `src/` to
  `packages/whatsapp-sdk/src/`. Workspace tooling lifts to root.
  CI green proves no regressions.
- **Bundle size:** SDK bundle unchanged (deps don't shift). MCP
  CLI bundle ~250 KB (MCP-SDK + zod-to-json-schema dominate). Own
  `size-limit` budgets.
- **Install footprint:** SDK-only users unaffected by the MCP
  package's existence. MCP users do
  `npx -y @dojocoding/whatsapp-mcp` — single command, no peer
  install dance.
- **Versioning:** SDK bumps from `0.7.4` (under old name) to
  `0.8.0` (under new name) to mark the rename. MCP server
  launches at `0.1.0` (Phase C1) and `0.2.0` (Phase C2).
  Tags use prefixes so the release workflow disambiguates:
  `sdk-v0.x.x` for SDK, `mcp-v0.x.x` for MCP.
- **Provenance:** both packages publish with `npm publish
  --provenance` via the existing OIDC flow.
- **Docs:** rebuild around the two-package story. The current
  SDK-only `docs/` tree moves to `docs/sdk/`; new `docs/mcp/`,
  `docs/cookbook/{mcp,hybrid}/`, and the load-bearing
  `docs/when-to-use-which.md` land in Phase C3.
