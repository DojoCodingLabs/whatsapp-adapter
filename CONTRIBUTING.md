# Contributing to `@dojocoding/whatsapp`

`@dojocoding/whatsapp` is MIT-licensed and accepts external contributions.
Whether you're a Dojo Coding engineer or an outside contributor, the
engineering workflow below is the same — read it before you open a branch
or a PR.

## TL;DR

1. Every meaningful change is **proposed as an OpenSpec change before code is
   written**. Specs first, then implementation.
2. Every public-API change pairs with at least one test (unit / contract /
   integration / parity, depending on the layer).
3. Each commit must leave the tree typecheck-, lint-, format-, and
   test-clean. CI re-runs everything; pre-commit hooks catch what they can
   locally.

## 1. Spec-driven development

Capabilities live under `openspec/specs/<capability>/spec.md` and are the
authoritative description of behaviour. Any change that adds, modifies, or
removes a requirement starts as an OpenSpec change proposal under
`openspec/changes/<name>/`.

```bash
openspec new change add-something            # scaffold proposal/design/tasks/spec deltas
openspec instructions <id> --change ...      # fetch artifact templates
openspec validate --change add-something     # lint the proposal
# … implement against the proposal …
openspec archive add-something               # merge spec deltas into specs/
```

Read `openspec/config.yaml` once before your first PR. The "Domain rules —
never violate" block in that file is the contract — every requirement we
write must satisfy it. The conventions block also defines naming, error
typing, and commit hygiene for the whole repo.

If you're not sure whether something needs a change proposal, ask. The bias
is towards "yes, file one" — proposals are cheap and the spec deltas land in
`openspec/specs/` once archived, which keeps the docs honest.

## 2. Branching and commits

- Branch from `main`. Keep branches short-lived.
- **Atomic commits** — one logical change per commit. Conventional Commits
  style: `feat(scope):`, `fix(scope):`, `docs(scope):`, `test(scope):`,
  `chore(scope):`, etc. Look at `git log` for the local flavour.
- Each commit must compile, lint, format-check, and test-clean on its own
  (`git rebase -i` to fix this before pushing).
- Don't squash-on-merge unless the branch is genuinely a single logical
  change — we use `git log` for archaeology and merging granular history is
  often the better signal.

## 3. Tests — what each layer is for

The `test/` tree is structured by what each suite proves:

| Layer       | Path                            | What it proves                                                                    | Real network?        |
| ----------- | ------------------------------- | --------------------------------------------------------------------------------- | -------------------- |
| Unit        | `test/unit/<capability>/`       | One module's behaviour in isolation                                               | No                   |
| Contract    | `test/contract/<capability>/`   | Public API surface vs spec scenarios                                              | No (msw mocks Graph) |
| Integration | `test/integration/<framework>/` | End-to-end through a framework adapter (Express + supertest)                      | No                   |
| Parity      | `test/parity/`                  | `MockWhatsAppClient` and `WhatsAppClient` produce equivalent observable behaviour | No                   |
| (E2E)       | gated by `WHATSAPP_E2E=1`       | Real Graph API sandbox calls                                                      | Yes — nightly only   |

When you add or change behaviour:

- **Public API changes** → unit + contract tests.
- **New error class** → at least one negative-path test (rule from
  `openspec/config.yaml`: every error class introduced has an
  `add-test-for-X-error` task).
- **Builder validation** → both happy path and rejection path.
- **New webhook event kind** → parser unit test + receiver contract test +
  fixture under `test/__fixtures__/webhooks/`.

## 4. CI gates and coverage

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push
and PR to `main`:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm format:check`
4. `pnpm test:coverage` with thresholds **line ≥ 90%, branch ≥ 85%**
5. `pnpm build` and a smoke check that ESM, CJS, and `.d.ts` artefacts exist
   for both the root entry and `dist/adapters/express/`.
6. `openspec validate --changes --strict` and `openspec validate --specs
--strict` for any active proposal or stable spec.

If you legitimately need to drop coverage on a PR (e.g., adding a no-op type
re-export), justify it in the PR description. Don't disable the gate.

## 5. Local pre-commit hooks

`simple-git-hooks` registers a pre-commit hook that runs:

- `pnpm lint-staged` — ESLint + Prettier over staged files
- `pnpm typecheck` — full project typecheck

If a hook fails, fix the issue and create a **new** commit. Never use
`--no-verify` or `--amend` to skip the hook — the hook fired because
something was actually broken.

## 6. Style conventions

The hard rules (also in `openspec/config.yaml`):

- TypeScript strict on (`noImplicitAny`, `strictNullChecks`,
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). No `any` in
  production code.
- Errors are typed classes extending `WhatsAppError`. No throwing strings.
  No `any` in error payloads.
- The public surface is exported from `src/index.ts`. Sub-modules export
  from their own entry (e.g., `@dojocoding/whatsapp/express`).
- Never silently catch and swallow errors. Surface or wrap with context.
- Webhook bodies: capture **raw bytes** before any JSON parser. Re-serialised
  bodies will not pass HMAC verification.
- HMAC compare is timing-safe. Always.
- Pin Graph API version. Make it constructor-overridable.
- One library instance per WABA. Multi-WABA = multiple instances. Zero
  global state.

## 7. Pull request checklist

Before opening:

- [ ] OpenSpec change proposal exists (or this is a docs-only / chore PR).
- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`
      pass locally.
- [ ] New behaviour has tests at the right layer.
- [ ] No new `any`, no swallowed errors, no leaked credentials in error
      messages.
- [ ] Commits are atomic, conventional, and signed off by you.
- [ ] If you touched specs, `openspec validate --strict` is clean.

## 8. Releases

This package follows [Semantic Versioning](https://semver.org). While the
version is **pre-1.0**, minor versions may contain breaking changes; patch
versions are bug-fix only. The first stable release (`1.0.0`) will lock that
behaviour to the standard semver contract.

Cutting a release is a four-step process, gated by `.github/workflows/release.yml`:

1. **Land all PRs** for the release on `main`. The CI workflow must be green.
2. **Bump `package.json`** to the target version on a release branch
   (e.g. `release/0.2.0`).
3. **Update `CHANGELOG.md`** — add a new `## [X.Y.Z] — YYYY-MM-DD` section
   above `[Unreleased]` (if any) summarising user-visible changes. The
   release workflow fails fast if no matching entry exists.
4. **Tag and push:**

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   The tag triggers `release.yml`, which re-runs typecheck/lint/test/build,
   verifies tag-vs-`package.json`-vs-CHANGELOG agreement, then publishes
   to npm with [provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
   and creates a GitHub Release whose body is the new CHANGELOG section.

The workflow uses `NPM_TOKEN` from repo secrets — an automation token from
an account with **2FA enabled and `auth-only`** (the granular permission
that does not require 2FA on publish, since the workflow can't interact).
Never publish manually from a laptop; the provenance attestation requires
the OIDC token only available in GitHub Actions.

## 9. Reporting bugs

File a GitHub issue with a minimal repro and (PII-redacted) payload. For
security issues, see [`SECURITY.md`](./SECURITY.md) — please use private
disclosure rather than a public issue.
