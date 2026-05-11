# Contributing

This repository is a `pnpm` workspace shipping two MIT-licensed
npm packages: **`@dojocoding/whatsapp-sdk`** and
**`@dojocoding/whatsapp-mcp`**. It accepts external contributions
to either or both. The engineering workflow below is the same
whether you're a Dojo Coding engineer or an outside contributor —
read it before you open a branch or a PR.

## TL;DR

1. Every meaningful change is **proposed as an OpenSpec change
   before code is written**. Specs first, then implementation.
2. Every public-API change pairs with at least one test (unit /
   contract / integration / parity, depending on the layer).
3. Each commit must leave the tree typecheck-, lint-, format-,
   and test-clean across **both packages**. CI re-runs
   everything; pre-commit hooks catch what they can locally.

## 0. Layout in 30 seconds

```
.
├── packages/
│   ├── whatsapp-sdk/        # @dojocoding/whatsapp-sdk (the SDK)
│   └── whatsapp-mcp/        # @dojocoding/whatsapp-mcp (MCP server)
├── docs/                    # Single docs tree — see docs/README.md
├── openspec/                # Spec-driven proposals + archived changes
├── AGENTS.md                # Repo-wide invariants (read this!)
├── CLAUDE.md                # AI-assistant onboarding
└── pnpm-workspace.yaml
```

When in doubt about which package you're touching, see
[`docs/when-to-use-which.md`](./docs/when-to-use-which.md).

## 1. Spec-driven development

Capabilities live under `openspec/specs/<capability>/spec.md`
and are the authoritative description of behaviour. There are
nine specs total — eight SDK capabilities
(`cloud-api-client`, `message-builders`, `webhook-receiver`,
`window-tracker`, `template-management`, `mock-mode`,
`observability`, `framework-adapters`, `outbound-queue`) plus
`mcp-server`.

Any change that adds, modifies, or removes a requirement starts
as an OpenSpec change proposal under
`openspec/changes/<name>/`.

```bash
openspec new change add-something            # scaffold proposal/design/tasks/spec deltas
openspec instructions <id> --change ...      # fetch artifact templates
openspec validate --change add-something     # lint the proposal
# … implement against the proposal …
openspec archive add-something               # merge spec deltas into specs/
```

Read `openspec/config.yaml` once before your first PR. The
"Domain rules — never violate" block is the contract. The
conventions block also defines naming, error typing, and commit
hygiene for the whole repo.

**Pure docs / chore changes skip OpenSpec** — they don't touch
behaviour. That includes README polish, doc-comment fixes, and
CI tweaks.

If you're not sure whether something needs a change proposal,
ask. The bias is towards "yes, file one" — proposals are cheap
and the spec deltas land in `openspec/specs/` once archived,
which keeps the docs honest.

## 2. Branching and commits

- Branch from `main`. Keep branches short-lived.
- **Atomic commits** — one logical change per commit.
  Conventional Commits style: `feat(scope):`, `fix(scope):`,
  `docs(scope):`, `test(scope):`, `chore(scope):`, etc. Use
  `whatsapp-sdk` or `whatsapp-mcp` as the scope when the change
  is package-local; use a different scope (e.g. `workspace`,
  `ci`, `docs`) when it's cross-cutting.
- Each commit must compile, lint, format-check, and test-clean
  on its own across both packages.
- Don't squash-on-merge unless the branch is genuinely a single
  logical change — we use `git log` for archaeology and merging
  granular history is often the better signal.

## 3. Tests — what each layer is for

All paths below are relative to the package they're in. SDK
tests live under `packages/whatsapp-sdk/test/`; MCP tests live
under `packages/whatsapp-mcp/test/`.

| Layer        | Path                                              | What it proves                                                                            | Real network?        |
| ------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------- |
| Unit         | `test/unit/<capability>/`                         | One module's behaviour in isolation                                                       | No                   |
| Contract     | `test/contract/<capability>/`                     | Public API surface vs spec scenarios                                                      | No (msw mocks Graph) |
| Integration  | `test/integration/<framework>/`                   | End-to-end through a framework adapter (Express + supertest)                              | No                   |
| Parity       | `test/parity/`                                    | `MockWhatsAppClient` and `WhatsAppClient` produce equivalent behaviour                    | No                   |
| MCP contract | `packages/whatsapp-mcp/test/contract/`            | Tool / resource / prompt surface via MCP `InMemoryTransport` (Client ↔ Server in-process) | No                   |
| Drift        | `test/contract/public-surface.test.ts`            | Every documented export still exists; tool / resource names align                         | No                   |
| (E2E)        | gated by `WHATSAPP_E2E=1` or `WHATSAPP_MCP_E2E=1` | Real Graph API sandbox / spawned-bin round trip                                           | Yes — nightly only   |

When you add or change behaviour:

- **Public SDK API changes** → unit + contract tests.
- **New MCP tool / resource / prompt** → contract test that
  drives it through the in-memory transport, plus an entry in
  the public-surface drift detector.
- **New error class** → at least one negative-path test (rule
  from `openspec/config.yaml`: every error class introduced has
  an `add-test-for-X-error` task). If the error reaches the
  MCP server, also extend
  `packages/whatsapp-mcp/test/unit/errors.test.ts` to assert
  the recovery hint.
- **New webhook event kind** → parser unit + receiver contract
  - fixture under
    `packages/whatsapp-sdk/test/__fixtures__/webhooks/`.

## 4. CI gates and coverage

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs
on every push and PR to `main`:

1. `pnpm install --frozen-lockfile` (workspace root)
2. `pnpm --filter @dojocoding/whatsapp-sdk build` (SDK first
   — MCP typecheck depends on the SDK's `dist/` types via
   `workspace:*`)
3. `pnpm -r typecheck` (both packages)
4. `pnpm -r lint` (both packages)
5. `pnpm format:check`
6. SDK `pnpm test:coverage` with thresholds
   **line ≥ 90%, branch ≥ 85%, function ≥ 90%, statement ≥ 90%**
7. MCP `pnpm test:coverage` with thresholds
   **line ≥ 95%, branch ≥ 65%, function ≥ 95%, statement ≥ 95%**

   The MCP branch threshold is intentionally lower than the SDK's.
   ~22 of the package's branches come from a single mechanical
   idiom — conditional spreads of optional zod fields,
   `...(x !== undefined ? { x } : {})` — used in every tool to
   pass-through optional parameters. Covering both branches of
   every conditional spread would require ~20 additional tests
   whose only value is line coverage of an idiom the type system
   already proves correct. We hold MCP branch coverage at **65%**
   intentionally; raising it requires deleting the idiom (a
   design decision, not a coverage commitment).

   The 65% commitment is stable across the 1.x line. New tools
   that introduce non-mechanical branches must still hit the
   per-file 80% branch level expected by the contract suite.

8. `pnpm -r build` and a smoke check that ESM, CJS, `.d.ts`
   artefacts + the MCP bin (`+x` executable) exist
9. `pnpm -r size` — size-limit budgets per entry point, per
   package
10. Per-package `pnpm pack` dry-run with the expected tarball
    contents
11. `openspec validate --changes --strict` and
    `openspec validate --specs --strict` for any active
    proposal or stable spec

If you legitimately need to drop coverage on a PR (e.g., adding
a no-op type re-export), justify it in the PR description.
Don't disable the gate.

## 5. Local pre-commit hooks

`simple-git-hooks` registers a pre-commit hook that runs:

- `pnpm lint-staged` — ESLint + Prettier over staged files
- `pnpm -r typecheck` — full workspace typecheck

If a hook fails, fix the issue and create a **new** commit.
Never use `--no-verify` or `--amend` to skip the hook — the
hook fired because something was actually broken.

## 6. Style conventions

The hard rules (also in `openspec/config.yaml`):

- TypeScript strict on (`noImplicitAny`, `strictNullChecks`,
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). No
  `any` in production code.
- Errors are typed classes extending `WhatsAppError`. No
  throwing strings. No `any` in error payloads.
- The SDK's public surface is exported from
  `packages/whatsapp-sdk/src/index.ts`. Sub-modules export from
  their own entry (e.g., `@dojocoding/whatsapp-sdk/express`).
- The MCP package's public surface is exported from
  `packages/whatsapp-mcp/src/index.ts`. Tool / resource / prompt
  name constants are exported too — the drift detector pins
  them.
- Never silently catch and swallow errors. Surface or wrap with
  context.
- Webhook bodies: capture **raw bytes** before any JSON parser.
  Re-serialised bodies will not pass HMAC verification.
- HMAC compare is timing-safe. Always.
- Pin Graph API version. Make it constructor-overridable.
- One library instance per WABA-phone pair. Multi-WABA = multiple
  instances. Zero global state.
- **MCP-specific:** stdio diagnostics go to **stderr** only,
  never stdout. Tool args never accept credentials.

## 7. Pull request checklist

Before opening:

- [ ] OpenSpec change proposal exists (or this is a docs-only /
      chore PR).
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm format:check && pnpm -r test`
      pass locally across **both packages**.
- [ ] New behaviour has tests at the right layer.
- [ ] If MCP-side: the drift detector at
      `packages/whatsapp-mcp/test/contract/public-surface.test.ts`
      reflects any new tool / resource / prompt name.
- [ ] No new `any`, no swallowed errors, no leaked credentials
      in error messages.
- [ ] Commits are atomic, conventional, and signed off by you.
- [ ] If you touched specs, `openspec validate --strict` is
      clean.

## 8. Releases

Both packages follow [Semantic Versioning](https://semver.org).
While each version is **pre-1.0**, minor versions may contain
breaking changes; patch versions are bug-fix only. First stable
release (`1.0.0` per package) will lock that behaviour to the
standard semver contract.

Each package versions independently. **Tag prefix disambiguates
which package the release publishes:**

| Tag prefix   | Package                    | Working dir              |
| ------------ | -------------------------- | ------------------------ |
| `sdk-vX.Y.Z` | `@dojocoding/whatsapp-sdk` | `packages/whatsapp-sdk/` |
| `mcp-vX.Y.Z` | `@dojocoding/whatsapp-mcp` | `packages/whatsapp-mcp/` |

Cutting a release is a four-step process, gated by
`.github/workflows/release.yml`:

1. **Land all PRs** for the release on `main`. The CI workflow
   must be green.
2. **Bump the target package's `package.json`** to the new
   version (e.g.
   `packages/whatsapp-mcp/package.json` → `"version": "0.3.0"`).
3. **Update the package's CHANGELOG** — add a
   `## [X.Y.Z] — YYYY-MM-DD` section summarising user-visible
   changes. The release workflow fails fast if no matching
   entry exists.
4. **Tag and push:**

   ```bash
   git tag -a sdk-vX.Y.Z -m "sdk-vX.Y.Z"   # or mcp-vX.Y.Z
   git push origin sdk-vX.Y.Z
   ```

   The tag triggers `release.yml`, which re-runs the full gate
   across both packages, verifies tag-vs-`package.json`-vs-CHANGELOG
   agreement for the target package, then publishes the target
   package to npm with
   [provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
   and creates a GitHub Release whose body is the new CHANGELOG
   section.

The workflow uses `NPM_TOKEN` from repo secrets — an automation
token from an account with **2FA enabled and `auth-only`**
(the granular permission that does not require 2FA on publish,
since the workflow can't interact). Never publish manually from
a laptop; the provenance attestation requires the OIDC token
only available in GitHub Actions.

### Deprecating an old name or version

Use the manually-triggered
[`Deprecate npm package`](./.github/workflows/deprecate-package.yml)
workflow:

```bash
gh workflow run deprecate-package.yml \
  -f package="@dojocoding/whatsapp" \
  -f version-range='*' \
  -f message="Renamed to @dojocoding/whatsapp-sdk."
```

This authenticates via the same `NPM_TOKEN` secret used by the
release workflow.

## 9. Reporting bugs

File a GitHub issue with a minimal repro and (PII-redacted)
payload. For security issues, see
[`SECURITY.md`](./SECURITY.md) — please use private disclosure
rather than a public issue.
