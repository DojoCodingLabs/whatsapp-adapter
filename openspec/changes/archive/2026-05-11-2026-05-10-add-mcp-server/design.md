## Context

`@dojocoding/whatsapp-sdk` (renamed from `@dojocoding/whatsapp`
as part of this change — see Decision 0) ships a typed SDK for
Meta's WhatsApp Cloud API. This change adds an MCP server that
surfaces the SDK's outbound API as Model Context Protocol tools,
resources, and prompts so that LLM agents (Claude Desktop, Claude
Agent SDK, Cursor, Cline, any MCP-compatible runtime) can drive
WhatsApp sends directly.

Domain constraints from `AGENTS.md` and `CLAUDE.md` this design
must honour:

- **Zero global state.** One client per WABA-phone pair. The MCP
  server holds exactly one `WhatsAppClient` instance for its
  lifetime, bound to env-loaded credentials. Multi-WABA = multi
  server-processes.
- **Typed errors via `instanceof`.** The error mapping layer
  dispatches off the SDK's existing `WhatsAppError` subclass
  hierarchy, not error-code strings.
- **Spec-driven.** This proposal lands first; implementation
  follows. `openspec validate --strict` is the gate.
- **Tests at the right layer.** Unit tests for input schemas,
  contract tests for tool wire shapes via an in-memory transport,
  one gated E2E for the spawned-bin path.

External constraints from the MCP ecosystem (verified May 2026):

- **Spec revision `2025-11-25` is stable.** No breaking changes
  pending in the 2026 roadmap.
- **`@modelcontextprotocol/sdk@^1.29`** is the right pin. v2.x
  alpha exists on `main` but is unpublished and reshapes
  imports — skip.
- **stdio transport for v1.** Streamable HTTP is the v2 candidate
  if/when we host a remote server. SSE is deprecated.
- **Resource subscriptions exist in spec but most clients don't
  implement them.** Claude Desktop ignores them. Our resources
  are read-once.
- **Long-poll tools (`wait_for_inbound`) collide with the default
  60-second MCP request timeout.** Out of scope; the Tasks
  primitive is experimental.

## Goals / Non-goals

### Goals

1. Make every outbound `WhatsAppClient.sendX(...)` callable by an
   LLM as a single MCP tool with a zod input schema and a stable
   `structuredContent` output.
2. Surface 24-h-window state and the template registry as MCP
   resources so the LLM can read them without spending a tool
   call.
3. Make Claude Desktop integration a one-liner in the user's
   `claude_desktop_config.json`.
4. Keep the SDK's install footprint unchanged — MCP deps ship
   in a sibling package, not as new SDK dependencies.
5. Preserve every existing SDK test, behaviour, public export.
6. Map SDK typed errors to MCP tool-error responses so the LLM
   can self-correct (window closed → suggest a template; rate
   limit → wait + retry).

### Non-goals

(See proposal.md § Non-goals.) Summary: no inbound surface
through MCP, no Streamable HTTP transport, no media upload
through tool args, no sticker/reply/mark-as-read in v1, no
multi-WABA-per-process, no permission filter in v1.

## Decisions

### Decision 0 — rename the SDK to `@dojocoding/whatsapp-sdk`

**Decision:** The existing `@dojocoding/whatsapp` package is
renamed to `@dojocoding/whatsapp-sdk` as part of this change.
The 13 published versions on the old name stay live (registry
immutability); the name is `npm deprecate`-d with a redirect
message; the SDK bumps to `0.8.0` under the new name to mark
the rename milestone. MCP launches at `0.1.0` under
`@dojocoding/whatsapp-mcp`.

**Rationale:** symmetrical naming with the new MCP sibling
("SDK + MCP" reads cleanly everywhere), and pre-1.0 is the
right moment. Adoption of the old name is vanishingly low (first
publish was yesterday). Bundling the rename with the MCP launch
gives us one coherent "two-package architecture" announcement
rather than two churn moments.

**Alternatives considered:**

- **Keep the existing name + publish a sibling**:
  `@dojocoding/whatsapp` (SDK) + `@dojocoding/whatsapp-mcp`
  (MCP). Rejected: asymmetric, harder to surface "they're
  siblings" in docs, awkward for the eventual 1.0.
- **Bump straight to 1.0 with the rename**: 0.8.0 vs 1.0.0.
  Rejected: 1.0 should be a deliberate "API is now frozen"
  moment, not bundled with infrastructure churn. 0.8.0 keeps
  the option open.
- **Republish all old versions under the new name**: rejected.
  Adds zero value (no one is pinned to old versions yet),
  doubles the registry footprint, complicates provenance
  attestation chain.

**Migration steps:**

1. Update `package.json` `name` field in the moved package.
2. Update every internal import that uses the package name as a
   bare-specifier resolution target (none in current source —
   all internal imports are relative).
3. Tag-prefix the next release as `sdk-v0.8.0`.
4. After the release publishes successfully, run
   `npm deprecate @dojocoding/whatsapp@"*" "Renamed to @dojocoding/whatsapp-sdk — install that package instead."`
   from the workspace root in CI as a one-shot step.

### Decision 1 — package shape: two packages via pnpm workspace

**Decision:** Convert the repo to a pnpm workspace with two
packages:

- `packages/whatsapp-sdk/` → `@dojocoding/whatsapp-sdk` (renamed SDK).
- `packages/whatsapp-mcp/` → `@dojocoding/whatsapp-mcp` (new MCP server).

**Alternatives considered:**

- **(A) Single package, subpath `/mcp` + bin, MCP-SDK as runtime
  dep.** Rejected: every SDK install pulls ~250 KB of MCP-SDK +
  zod-to-json-schema even for consumers who never use MCP.
  Violates the established peer-dep convention
  (express/hono/ioredis/pg are all optional peers).
- **(B) Single package, subpath `/mcp` + bin, MCP-SDK as
  optional peer.** Rejected: `npx -y @dojocoding/whatsapp-sdk`
  does not pull peers, so the bin fails out-of-the-box. The
  standard MCP UX is "one `npx` command, just works"; users
  shouldn't need to `npm i` peers first.
- **(C) Separate package via pnpm workspace.** Chosen. Matches
  how Stripe / Slack / GitHub / Postgres MCP servers ship.
  Independent versioning. Clean install footprint. Real cost:
  ~3 hours of mechanical workspace refactor (Phase C0), which is
  cheap relative to the 5+ MCP releases this enables before we
  hit 1.0.

**Implication for CI:** the release workflow needs to disambiguate
tags. Convention:

| Tag prefix | Package | Working dir |
| ---------- | ------- | ----------- |
| `sdk-v0.x.x` | `@dojocoding/whatsapp-sdk` | `packages/whatsapp-sdk/` |
| `mcp-v0.x.x` | `@dojocoding/whatsapp-mcp` | `packages/whatsapp-mcp/` |

Both prefixes are new (the legacy `v0.x.x` retires with the
rename). `actions/checkout` + a `working-directory` step keeps
both publish jobs simple.

### Decision 2 — bin name: `dojo-whatsapp-mcp`

**Decision:** The MCP package's `bin` field is
`{ "dojo-whatsapp-mcp": "./dist/cli.js" }`.

**Alternatives considered:**

- `whatsapp-mcp` — shortest, but collides with the unrelated
  `whatsapp` npm package's PATH binary if both are globally
  installed. Low risk in practice; ruled out for unambiguity.
- `mcp-server-whatsapp` — matches the `@modelcontextprotocol/server-*`
  family. Rejected: we are not in that namespace.
- `dojo-whatsapp-mcp` — namespaced to our publisher, no
  collision risk, clear in Claude Desktop config diff. Chosen.

The full Claude Desktop config snippet becomes:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npx",
      "args": ["-y", "@dojocoding/whatsapp-mcp"],
      "env": {
        "WHATSAPP_ACCESS_TOKEN": "EAAG...",
        "WHATSAPP_PHONE_NUMBER_ID": "1234567890"
      }
    }
  }
}
```

Note: with the `npx -y @dojocoding/whatsapp-mcp` form, the bin
name only matters when invoked directly from a shell. `npx`
resolves the package, sees the `bin` map, and picks the first
entry. We document both forms.

### Decision 3 — MCP transport: stdio only for v1

**Decision:** v1 ships only `StdioServerTransport`. The CLI
`packages/whatsapp-mcp/src/cli.ts` is the entry point Claude
Desktop spawns; programmatic embedding via
`WhatsAppMcpServer.connect(transport)` accepts any
`@modelcontextprotocol/sdk` transport but the only one we test
+ document is stdio.

**Implications:**

- All logging goes to `stderr` via `console.error`. Writing to
  `stdout` corrupts the JSON-RPC framing. We provide a minimal
  internal logger that defaults stderr, configurable via
  `MCP_LOG_LEVEL=debug|info|warn|error`.
- One process per WABA-phone pair, spawned by the MCP host.
- `Streamable HTTP` is a deliberate v2 follow-up. The class layout
  (`WhatsAppMcpServer` decoupled from transport choice) keeps
  that path open.

### Decision 4 — auth via env vars, never tool args

**Decision:** Credentials load at CLI startup from env vars,
with optional CLI flag fallback:

| Env var | CLI flag | Required | SDK field |
| ------- | -------- | -------- | --------- |
| `WHATSAPP_ACCESS_TOKEN` | `--access-token` | yes | `accessToken` |
| `WHATSAPP_PHONE_NUMBER_ID` | `--phone-number-id` | yes | `phoneNumberId` |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `--business-account-id` | no | `businessAccountId` |
| `WHATSAPP_API_VERSION` | `--api-version` | no (defaults to SDK constant) | `apiVersion` |
| `WHATSAPP_APP_SECRET` | `--app-secret` | no (not used for outbound; reserved) | `appSecret` |

Missing required values → CLI exits with code 1 and a clear
stderr message. **No tool accepts credentials as arguments** —
the model could echo them in `content[].text` and leak them into
transcripts / training data.

For programmatic embedding, `new WhatsAppMcpServer({ client })`
accepts a pre-constructed `WhatsAppClient` instance; the env-var
loader is the CLI's concern.

### Decision 5 — tool naming + grouping

**Decision:** `whatsapp_<verb>_<resource>` snake_case. One tool
per outbound endpoint, not grouped. Matches Slack's `slack_*`
and Stripe's per-endpoint pattern. The full list lives in the
spec.

Builders (`buildText`, etc.) are **not** exposed — the LLM does
not benefit from building a payload object and then sending it
as a second step. Each `whatsapp_send_*` tool internally calls
the matching builder + send method in one shot.

**Three exception tools** that don't follow the verb_resource
pattern:

- `whatsapp_send_interactive_buttons` and
  `whatsapp_send_interactive_list` split the SDK's single
  `sendInteractive` into two MCP tools because the input shapes
  diverge enough (1–3 buttons vs 1–10 sections each with 1–10
  rows) that one combined tool would have a confusing union
  schema.
- `whatsapp_send_template` covers the generic path;
  `whatsapp_send_auth_template` and
  `whatsapp_send_carousel_template` exist as separate tools
  because their input shapes are domain-specific (OTP code, card
  array) and the LLM picking the right tool is clearer than
  picking a discriminator inside one mega-tool.

### Decision 6 — input schemas in zod, output via structuredContent

**Decision:** Every tool declares:

```ts
{
  inputSchema: { /* zod field map */ },
  outputSchema: z.object({ messageId: z.string(), recipientPhone: z.string(), wabaPhoneNumberId: z.string() }),
  annotations: { readOnlyHint?: true, idempotentHint?: true }
}
```

Handler returns:

```ts
return {
  content: [{ type: "text", text: `sent ${out.messageId} to ${to}` }],
  structuredContent: { messageId: out.messageId, recipientPhone: to, wabaPhoneNumberId: PNID },
};
```

**Caveat:** SDK issue #654 reports that mismatched `structuredContent`
vs `outputSchema` silently swallows tool errors. We pin the
output shape across all send tools to exactly the three fields
above, keeping the schema and the runtime shape in lock-step. If
future tools need richer outputs we widen the shape with optional
fields rather than forking it.

### Decision 7 — error mapping to `isError: true`

**Decision:** Tool handlers `try`/`catch` around the SDK call:

```ts
try {
  const out = await client.sendText({ to, body });
  return successShape(out);
} catch (e) {
  if (e instanceof WhatsAppError) {
    return {
      content: [{ type: "text", text: formatForLlm(e) }],
      isError: true,
      structuredContent: { error: { code: e.code, message: e.message } },
    };
  }
  throw e; // unexpected — surface as JSON-RPC protocol error
}
```

`formatForLlm(e)` is a per-subclass formatter that includes:
- the human-readable message
- a one-line *suggested recovery* the LLM can act on
  (e.g. `WindowClosedError` → "the 24-hour customer-service
  window is closed for this recipient; send a pre-approved
  template instead via `whatsapp_send_template`").

This is the load-bearing UX choice: the model needs an
actionable next step, not just an error string. Mapping below:

| SDK error | LLM-actionable recovery hint |
| --------- | ---------------------------- |
| `WindowClosedError` | "Use `whatsapp_send_template` with an approved template." |
| `TemplateError` | "Inspect via `whatsapp_get_template` to verify variables and language." |
| `RateLimitError` | "Wait and retry — the response includes a `retryAfterMs`." |
| `AuthenticationError` | "Token rejected by Meta. Verify `WHATSAPP_ACCESS_TOKEN`." (Server log only — do NOT echo the token.) |
| `PermissionError` | "Token lacks the required scope. Likely fix: regenerate with `whatsapp_business_messaging` permission." |
| `CapabilityError` | "Phone number or WABA is not capability-enabled for this operation." |
| `WebhookSignatureError` / `MockModeError` | Not reachable from MCP tool handlers (inbound / test-only). |

### Decision 8 — MCP resources

**Decision:** Two resource URI schemes registered at server
startup:

- `whatsapp://window/{phone}` — reads
  `WindowTracker.isWindowOpen(phone)`. Returns
  `{ phone, isOpen: boolean, expiresAt?: ISO8601 }` (the
  `expiresAt` requires extending `WindowTracker` with a
  read-the-TTL method; if we don't want to widen that surface
  in this change, the resource returns `isOpen` only and we
  add `expiresAt` later).
- `whatsapp://templates` — reads `client.listTemplates()`.
  Returns the paginated template list. Cached for 60 seconds in
  process (template approval state changes rarely).

Resources are read-only. Updates come from the client polling.
No subscriptions (Claude Desktop doesn't implement them).

### Decision 9 — MCP prompts

**Decision:** One prompt for v1:

- `wa-template-send` — surfaces as `/wa-template-send` in Claude
  Desktop's slash-command picker. Takes optional
  `templateName` and `recipientPhone` arguments. Emits a guided
  user-message asking Claude to:
  1. Read `whatsapp://templates` (if `templateName` not given).
  2. Read the chosen template's schema via
     `whatsapp_get_template`.
  3. Ask the user for the variables.
  4. Call `whatsapp_send_template`.

This is a UX hint, not a state-changing surface. Low risk; high
value for the "I want to broadcast a marketing template" flow.

A second prompt (`wa-reply-quickly`) is a tempting add but is
inbound-flavoured (asks for the wamid to reply to) — defer with
inbound.

### Decision 10 — tests at four layers

| Layer | Where | What |
| ----- | ----- | ---- |
| Unit | `packages/whatsapp-mcp/test/unit/` | Per-tool input schema rejects bad input. Env loader rejects missing credentials. Error mapper produces correct LLM-recovery hint per `WhatsAppError` subclass. |
| Contract | `packages/whatsapp-mcp/test/contract/` | Spin up `WhatsAppMcpServer` in-process backed by `MockWhatsAppClient` from `@dojocoding/whatsapp-sdk`. Connect via `InMemoryTransport` from the MCP SDK. List tools → assert the 16 expected names. Call each tool with a happy-path payload → assert `structuredContent` shape. Call each tool with a forced `WhatsAppError` payload → assert `isError: true` + recovery hint. |
| Drift | `packages/whatsapp-mcp/test/contract/public-surface.test.ts` | Mirror the SDK's drift detector. Assert exactly the documented tool names, resource URI schemes, prompt names. |
| E2E (gated) | `packages/whatsapp-mcp/test/e2e/` | `WHATSAPP_MCP_E2E=1` only. Spawn the built bin via `npx ./packages/whatsapp-mcp`. Connect over real stdio. Send `initialize` + `tools/list` + a `tools/call` (mocked Meta upstream via msw). Assert the protocol round-trip works end-to-end. |

The MCP SDK ships an `InMemoryTransport` that pairs two ends; we
use that for contract tests so we don't have to spawn a
subprocess on every test run.

### Decision 11 — separate CHANGELOG, separate version cadence

**Decision:** `packages/whatsapp-mcp/CHANGELOG.md` is independent
from `packages/whatsapp-sdk/CHANGELOG.md`. The MCP server can
ship a patch (e.g. a new recovery-hint string) without forcing
an SDK release, and vice versa. The Keep-a-Changelog format and
the `bump → push → wait CI green → tag → release workflow
publishes` discipline both carry over from the existing SDK
release flow.

**Initial versions for this change:**

- `@dojocoding/whatsapp-sdk@0.8.0` — rename-and-republish.
  Continues the existing 0.7.x line under the new package name.
  `[0.8.0]` CHANGELOG entry explains the rename and migration
  diff.
- `@dojocoding/whatsapp-mcp@0.1.0` — first release. Greenfield.
  `[0.1.0]` CHANGELOG entry lists the C1 surface (core + 6
  tools).
- `@dojocoding/whatsapp-mcp@0.2.0` — Phase C2 release. Lists the
  remaining 10 tools + 2 resources + 1 prompt.
- `@dojocoding/whatsapp-mcp@0.2.1` — Phase C3 release (docs +
  cookbook fill-out). Documentation-only patch.

**Tag prefix convention:**

- `sdk-vX.Y.Z` → release workflow publishes `packages/whatsapp-sdk/`.
- `mcp-vX.Y.Z` → release workflow publishes `packages/whatsapp-mcp/`.

The release workflow has a guard step that reads the tag, parses
the prefix, locates the matching package directory, reads its
`package.json` `version`, and hard-fails if the tag's version
doesn't match. This prevents the most common release mistake
(tagging the wrong package).

### Decision 12 — docs architecture: single repo-root `docs/`, two subtrees + hybrid showcase

**Decision:** All long-form documentation lives at the repo root
under `docs/`, organised into three subtrees plus a few
top-level cross-cutting pages. Each package ships only a short
README in its tarball; the README links to the live docs on
GitHub. The final tree (see proposal § "Docs reorganisation"):

```
docs/
├── README.md
├── when-to-use-which.md       # ★ decision tree
├── architecture.md            # how SDK + MCP fit together
├── compliance.md              # cross-cutting
├── compatibility.md           # cross-cutting
├── sdk/                       # SDK reference (existing pages, moved)
├── mcp/                       # MCP reference (new)
└── cookbook/
    ├── sdk/                   # server-side patterns
    ├── mcp/                   # agent-driven patterns
    └── hybrid/                # ★ SDK + MCP together
```

**Alternatives considered:**

- **Per-package `packages/*/docs/`** — rejected. Cross-cutting
  recipes (the `hybrid/` folder, which is the strongest
  production pattern) would have no home. `compliance.md` and
  `compatibility.md` would duplicate across packages.
- **Doc site (Astro / Starlight / etc.)** — rejected per user
  decision; not adding a doc site in this iteration.
  Markdown-on-GitHub is the format.

**Three places where the complementary relationship between
SDK and MCP is made visible:**

1. **Root README** — opens with a two-package diagram and a
   capabilities table putting them side by side.
2. **`docs/when-to-use-which.md`** — single-page decision tree.
   The first link from the root README, designed to orient a
   new visitor in 30 seconds.
3. **Each package's README** — opens with a "sibling package"
   callout (`→ Building an agent? See @dojocoding/whatsapp-mcp.`
   and the inverse), so a user who arrives via `npm view` or
   the npm package page sees the other half immediately.

**The `docs/cookbook/hybrid/` folder is the load-bearing
showcase.** Three recipes live there in Phase C3:

- `agent-handoff-loop.md` — agent triggers outbound template via
  MCP; consumer's app receives the customer reply via the SDK's
  webhook receiver; consumer routes that reply back into the
  agent's runtime (e.g. via the Claude Agent SDK's
  `addToolResult`). The end-to-end "agent that can both push and
  pull" pattern.
- `inbound-routed-to-agent.md` — inbound-first variant: the SDK
  receives a customer message, classifies intent (LLM call), and
  hands off to a long-running MCP agent that drives subsequent
  outbound steps.
- `compliance-broadcast.md` — server-side compliance: marketing
  team triggers a templated broadcast through the agent (MCP);
  the server-side handler validates against the consent ledger
  (SDK) before passing through.

These three recipes are what makes the two-package architecture
feel inevitable rather than arbitrary.

### Decision 13 — README content shape for each tarball

**Decision:** Each package's `README.md` (shipped in the npm
tarball) is exactly five sections, in order:

1. **One-line description** + sibling-package callout.
2. **Install** + minimum config (1–2 commands).
3. **30-line happy-path example** (one TypeScript code block).
4. **What this package is / is NOT** (3 bullets each).
5. **Where the docs live** — link to `docs/` on GitHub.

The README is not the place for the full tool catalogue, the
architecture rationale, or the cookbook. Those live in the
`docs/` tree and stay there. The README is the front door, not
the building.

## Risks / Trade-offs

- **Tag prefix discipline.** If a release-workflow author later
  forgets the `mcp-v` prefix and tags an MCP release as
  `v0.x.x`, the SDK publish job fires instead. Mitigation: a tag
  prefix guard in the release workflow that hard-fails if the
  package version and the tag don't match.
- **`@modelcontextprotocol/sdk` v2.x is on the horizon.** The
  monorepo split (`@modelcontextprotocol/server`) will reshape
  imports. We pin to `^1.29` and treat the v2 migration as a
  separate spec change when it ships stable.
- **Resource cache staleness.** The 60-second template-list cache
  can lag a Meta admin-side approval. Acceptable: templates
  don't get approved minute-by-minute. Documented in the
  resource's description.
- **Bin name collision.** `dojo-whatsapp-mcp` is unique enough
  that we don't expect collisions. If a user already has another
  npm package shipping the same bin, npm will surface a warning
  at global install time. `npx -y @dojocoding/whatsapp-mcp`
  bypasses this entirely (resolves via package name).
- **MCP error semantics drift.** The "use isError: true for
  recoverable, throw for protocol" convention is well-established
  in May 2026 but the spec language isn't perfectly tight on the
  boundary. Our error mapper is the single point of policy; we
  iterate it as we learn what hints actually help models recover.

## Migration plan

### For consumers of the existing `@dojocoding/whatsapp` SDK

A one-line `package.json` change is the entire migration.
Functionally:

```diff
   "dependencies": {
-    "@dojocoding/whatsapp": "^0.7.0"
+    "@dojocoding/whatsapp-sdk": "^0.8.0"
   }
```

…plus a find-and-replace on the package name in every `import`
statement:

```diff
- import { WhatsAppClient } from "@dojocoding/whatsapp";
+ import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
```

No symbol renames. No type changes. No behaviour change. The
14-line "migrating from 0.7 to 0.8" guide ships as part of the
SDK CHANGELOG `[0.8.0]` entry.

### For the npm registry

After `@dojocoding/whatsapp-sdk@0.8.0` publishes successfully,
the release workflow runs one extra step:

```bash
npm deprecate "@dojocoding/whatsapp@*" \
  "Renamed to @dojocoding/whatsapp-sdk. Replace your import and bump to ^0.8.0."
```

The 13 published versions remain installable (npm immutability);
pinned consumers keep working; `npm install @dojocoding/whatsapp`
now prints the deprecation banner.

### For the workspace internals

The workspace refactor (Phase C0) is mechanical: every file under
`src/`, `test/`, `dist/`, etc. moves to
`packages/whatsapp-sdk/<same-path>`. Internal imports inside the
SDK are all relative (`../webhooks/signature`) and require no
changes. The MCP package declares its dependency on the SDK as
`"@dojocoding/whatsapp-sdk": "workspace:*"` — pnpm resolves that
to the local workspace package during dev and rewrites it to a
fixed range (`^0.8.0`) at publish time.

## Open questions

- **Should the resource `whatsapp://window/{phone}` require the
  `WindowTracker` instance to be wired with a real `Storage`?**
  In-memory storage means the window state is per-process, so
  reads from a fresh MCP server give "closed for every phone"
  until inbound traffic populates the tracker. We document this
  in the resource's description and recommend Redis/Postgres
  Storage for production. Not a v1 blocker.
- **Telemetry inside the MCP server.** The SDK has
  observability hooks (`withSpan`, `setRedactSalt`). Should the
  MCP layer wrap tool handlers in OTel spans named
  `mcp.tool.<name>`? Probably yes, but it's additive — defer
  to a follow-up if the first round of consumers ask for it.
- **A `whatsapp_test_send` tool that uses MockWhatsAppClient.**
  Tempting for self-test from inside Claude Desktop. Defer —
  user-facing test endpoints in production servers are an
  attractive nuisance.
