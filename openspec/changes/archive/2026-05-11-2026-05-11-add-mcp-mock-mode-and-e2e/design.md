## Context

The MCP package's contract tests are exhaustive at the **logic
layer** (106 tests, 98.6 / 72.1 / 100 / 98.6 coverage) but blind
to the **packaging layer**: the post-tsup `dist/cli.js`
artefact, the shebang/chmod machinery, real-stdio JSON-RPC
framing, process spawn semantics, and exit codes.

This change adds the missing test layer (E2E spawn-the-bin)
plus the affordance the test depends on (`WHATSAPP_MODE=mock`
on the bin) — which is also a useful public feature for
prompt-engineering preview and downstream consumer CI.

Domain constraints this design must honour:

- **Stdio framing discipline.** The mcp-server spec already
  mandates "stderr-only diagnostics" — anything on stdout
  outside JSON-RPC frames breaks the host parser. The E2E
  suite needs to ASSERT this contract, not just trust it.
- **Zero global state per-process.** `pickWhatsAppClient`'s
  decision is per-process (one bin invocation = one client
  type). Mock mode is a startup flag, not a runtime toggle.
- **Spec-driven.** This change extends the existing
  `mcp-server` spec; it doesn't introduce a new capability.

External constraints:

- The SDK already exports `pickWhatsAppClient` and already
  honours `WHATSAPP_MODE=mock` as a process env-var lookup.
  This change is consumer-side wiring only.
- Vitest supports `.skipIf(predicate)` test gating natively
  (since vitest 1.x).
- Node 20+'s `child_process.spawn` is the cross-platform
  spawn primitive. The shebang trick doesn't work on Windows
  natively; we invoke `node dist/cli.js` directly in the test
  (matching what `npx` does internally).

## Goals / Non-goals

### Goals

1. Catch every **packaging + runtime + protocol-on-wire**
   failure mode the contract tests can't see (the seven
   classes from the audit: shebang drop, chmod skip, console.log
   leak, missing dep, bad bin path, exit-code mismatch, real
   stdio framing).
2. Make the E2E suite **self-contained**: no real Meta
   credentials, no flakiness from Graph 5xx, no rate-limit
   contention with production WABAs.
3. Make `WHATSAPP_MODE=mock` a **public feature** for
   developers wiring up Claude Desktop without a real WABA.
4. **Don't slow down PR CI.** E2E is opt-in via
   `WHATSAPP_MCP_E2E=1`; runs on manual dispatch or nightly,
   never on every push.

### Non-goals

(See proposal.md § Non-goals.) Summary: no real Meta
integration, no Windows-shim E2E, no threshold tightening,
no SDK-side changes.

## Decisions

### Decision 1 — env var name and shape: `WHATSAPP_MODE=mock`

**Decision:** The env var is `WHATSAPP_MODE`, accepted values
`"real"` and `"mock"`. Default is `"real"`. Unknown values
fall back to `"real"` with a stderr warning (consistent with
how `MCP_LOG_LEVEL` parses).

**Rationale:** The SDK's `pickWhatsAppClient` already reads
this exact env var. Using a different name on the MCP side
would create a confusing two-name shape ("am I in mock mode
per the SDK env or per the MCP env?"). Single source of truth.

**Alternatives considered:**

- `MCP_MOCK=1` — different name, simpler boolean. Rejected:
  duplicates the existing SDK convention.
- `WHATSAPP_MCP_MODE` — MCP-specific. Rejected: collision risk
  with future SDK env-var changes; the user has to remember
  two near-identical names.
- A CLI flag only, no env var. Rejected: `claude_desktop_config.json`'s
  `env` block is more natural for the host-config pattern; the
  flag is added as a secondary affordance.

### Decision 2 — pickWhatsAppClient instead of conditional `new`

**Decision:** Replace `new WhatsAppClient(...)` in `cli.ts`
with `pickWhatsAppClient({...})`. The factory's existing
behaviour (env-var lookup → mock | real) does the dispatch.

**Rationale:** The factory is the SDK's documented integration
point for this. Re-implementing the dispatch in MCP would
violate the "single source of truth" principle and would
silently diverge if the SDK ever extended the factory.

**Risk:** the factory might in the future add behaviour the
MCP bin doesn't want (e.g., reading other env vars). Mitigation:
the SDK and MCP are in the same workspace; any change to the
factory triggers MCP contract tests via the workspace
typecheck.

### Decision 3 — E2E test runs against a freshly-built bin

**Decision:** The E2E test `beforeAll` runs `pnpm build` (via
`execFileSync`) before spawning. The test then spawns
`node dist/cli.js` directly.

**Rationale:** Testing the AS-RELEASED artefact. The CI
workflow can short-circuit this (the build step happens
upstream) but the test file itself stays runnable from a
clean checkout.

**Cross-platform consideration:** On Windows, `node dist/cli.js`
invocation works identically to Unix (the shebang is irrelevant
when Node is invoked directly). The bin's `chmod +x` is a
Unix-only concern; on Windows, npm generates a `.cmd` wrapper
that the actual `npx` user invokes. Testing the `.cmd` wrapper
is a v2 concern; we skip the Windows-specific test here.

### Decision 4 — JSON-RPC framing assertions

**Decision:** Each E2E test:

1. Spawns the child with `stdio: ["pipe", "pipe", "pipe"]`.
2. Writes a single JSON-RPC frame to stdin
   (`{"jsonrpc":"2.0","id":N,"method":"...","params":{...}}\n`).
3. Reads stdout incrementally; parses the first complete frame.
4. Buffers stderr for inspection after the test.

The MCP SDK 1.29 uses **newline-delimited JSON** (each frame
ends with `\n`), no `Content-Length` header (that's the
LSP-style framing, which MCP doesn't use). The test parses
accordingly.

**Stdout-discipline assertion:** after every test, we split
stdout by `\n`, attempt `JSON.parse` on each non-empty line,
and require ALL of them to parse successfully. Any line that
doesn't parse means someone leaked a non-JSON `console.log`
into stdout.

### Decision 5 — mock-mode test fidelity

**Decision:** The E2E `tools/call whatsapp_send_text` test
asserts the response's `structuredContent.messageId` matches
`/^wamid\.mock-/`. This is the load-bearing signal that:

- The shebang resolved (Node spawned the file).
- `chmod +x` worked (the file was executable).
- The env loader accepted the fake credentials and didn't
  exit 1.
- `pickWhatsAppClient` returned the mock (not the real client
  attempting a Graph call).
- The MCP server registered tools (`tools/list` returned 16).
- The tool handler ran and returned the mock's deterministic
  wamid.
- The JSON-RPC framing on real stdio worked end-to-end.

A single string match collapses the entire pipeline into one
assertion.

### Decision 6 — CI workflow shape

**Decision:** Create a new workflow file
`.github/workflows/mcp-e2e.yml`. Triggers:

- `workflow_dispatch` (manual button in the Actions UI)
- `schedule: cron "0 7 * * *"` (07:00 UTC daily;
  ~02:00 America/Mexico_City)

Job runs on `ubuntu-latest` (not Blacksmith — the E2E suite
spawns its own subprocesses and we want maximum environmental
fidelity to what npm users see). Doesn't need provenance
secrets (no npm publish).

**Alternatives considered:**

- Run E2E in the main CI workflow on every PR. Rejected: adds
  ~60 s per PR; failures would be noise during fast iteration.
- Pre-merge hook. Rejected: PR authors don't always have local
  build env identical to CI; the bin built on macOS dev box
  doesn't generalize.

### Decision 7 — un-exclude `cli.ts` from coverage

**Decision:** Remove `src/cli.ts` from the
`coverage.exclude` array in
`packages/whatsapp-mcp/vitest.config.ts`.

**Why now:** Once the E2E suite exercises `cli.ts`, excluding
it under-counts coverage. The exclusion was a pragmatic
"nothing currently exercises this" rather than a permanent
opt-out.

**But** vitest's default coverage run still excludes E2E
files from execution by default unless `WHATSAPP_MCP_E2E=1`
is set. So under PR CI conditions, `cli.ts` will report 0%
coverage because no test ran it.

**Resolution:** Two coverage modes:

- PR CI (default): `cli.ts` IS in the include list, but with no
  E2E running, it reports 0%. We **add `cli.ts` to a per-file
  conditional exclusion** that's lifted only when
  `WHATSAPP_MCP_E2E=1` is set:

  ```ts
  exclude: [
    "src/index.ts",
    ...(process.env.WHATSAPP_MCP_E2E === "1" ? [] : ["src/cli.ts"]),
  ],
  ```

  Under PR CI: `cli.ts` excluded; thresholds satisfied by the
  rest of the tree (current 98.6%+).
  Under E2E CI: `cli.ts` included; coverage will report on it;
  thresholds re-applied to the full tree.

### Decision 8 — keep credentials format-validated even in mock mode

**Decision:** `loadConfigFromEnv` still rejects missing
`WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` in mock
mode. Mock-mode users must supply *some* string value (any
non-empty).

**Rationale:** Matches what the SDK's `MockWhatsAppClient`
does — the mock requires `phoneNumberId` + `wabaId` to
construct (and surfaces them in `structuredContent.wabaPhoneNumberId`
so the agent can verify it's talking to the right test surface).
Skipping validation in mock mode would silently let typos
through, defeating the purpose.

The E2E test passes obvious placeholders (`fake-token-not-used-in-mock-mode`
etc.) — the env loader is happy; the mock client gets the
phone-number-id string for its `wamid` namespacing.

## Risks / Trade-offs

- **Mock-mode developers ship to production by mistake.**
  Mitigation: the bin writes `MOCK MODE` to stderr at startup
  when `WHATSAPP_MODE=mock` is set (loud signal). Production
  default is real; mock is opt-in via an explicit env var that's
  documented as "preview / development only."
- **E2E flakiness from subprocess startup timing.** Real
  subprocess spawn has ~100 ms variance; we set explicit
  timeouts per test (5 s) and use stdout-delimiter polling
  rather than fixed delays.
- **Nightly schedule timezone.** 07:00 UTC = 01:00 in
  America/Mexico_City — outside business hours; failures don't
  page until morning. Acceptable for a non-prod-affecting
  test layer.
- **`cli.ts` coverage gap during PR CI.** Documented in
  Decision 7. Under PR conditions, `cli.ts` stays excluded;
  the E2E nightly is the gate that exercises it.

## Migration plan

None. Pure addition. Existing `claude_desktop_config.json`
files keep working unchanged; the new env var defaults to the
existing real-mode behaviour.

## Open questions

- **Should the E2E test also run on `mcp-v*` tag pushes (i.e.,
  pre-release gate)?** Probably yes — catches "release tarball
  build broke" before it ships. Adding to the release workflow
  is a v1.1 follow-up; the nightly + dispatch is enough for now.
- **Should the bin print a clearer "you're in mock mode"
  banner?** Current plan: one stderr line at startup. If
  users actually get confused, we expand to a more prominent
  warning. Wait for feedback.
- **Should we expose the mock's recorded sends back to the
  agent / a host inspection endpoint?** Tempting for
  prompt-engineering workflows (the operator wants to see
  "what did Claude actually send?"), but it'd require a new
  MCP resource. Out of scope; track as a separate v1.1
  proposal if there's demand.
