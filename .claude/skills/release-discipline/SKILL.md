---
name: release-discipline
description: REQUIRED when about to tag or push a version tag, cut a release, publish to npm, or bump the package version. Enforces the pre-tag checklist (origin sync, CI green on the target SHA, package.json version matches the intended tag, CHANGELOG entry exists, clean working tree). Triggers on "ship X.Y.Z", "release X.Y.Z", "publish X.Y.Z", "tag vX.Y.Z", "cut a release", "let's release", or any `git tag -a v*` / `git push origin v*` invocation.
license: MIT
metadata:
  author: dojocoding
  version: "1.0"
---

# Release discipline for `@dojocoding/whatsapp`

This SDK ships to npm via a tag-triggered GitHub Actions workflow
(`.github/workflows/release.yml`). The workflow re-runs the full
test / lint / format / build / pack-contents suite before
`pnpm publish --provenance`. **If any of those checks fail, the tag
points at a broken commit, no release happens, and recovery means
either moving the tag (destructive, hard) or burning a version
number for nothing.**

This skill exists because that has already happened once. It must
not happen again.

## The contract — ALL must be true before tagging

1. The target commit is on `origin/main` (not just locally committed).
2. The latest CI workflow run on that exact SHA is **green**.
3. `package.json` `version` equals the intended `X.Y.Z`.
4. `CHANGELOG.md` contains a `## [X.Y.Z]` section.
5. Working tree is clean (`git status` shows nothing to commit).

If ANY check fails: **STOP**. Do not push the tag. Surface the failure
to the user and propose the fix path. Never push the tag "to see
what happens" — `release.yml` exists precisely so you don't have to.

## The required sequence

```
1. Land all PRs / commits for the release on main.
2. Push the version-bump + CHANGELOG commit to main:
     pnpm typecheck && pnpm lint && pnpm format:check && pnpm test  (locally)
     git push origin main
3. WAIT FOR CI TO GO GREEN ON THIS COMMIT:
     gh run list --branch main --limit 1
     gh run watch <run-id> --exit-status
   ^ this step is the one that gets skipped. Do not skip it.
4. Tag and push:
     git tag -a vX.Y.Z -m "vX.Y.Z"
     git push origin vX.Y.Z
5. Watch the release workflow itself:
     gh run watch <release-run-id> --exit-status
6. Confirm the publish landed:
     curl -sS https://registry.npmjs.org/@dojocoding/whatsapp/X.Y.Z | jq .version
```

## Pre-flight checklist (run before step 4)

```bash
# 0. Are we on a branch that's pushed?
git status
git log -1 --oneline
git log -1 --oneline origin/main
# (the two SHAs above MUST match)

# 1. Latest CI run on main: state?
gh run list --branch main --limit 1
# state must be 'completed' AND conclusion must be 'success'

# 2. package.json version matches the intended tag?
node -p "require('./package.json').version"

# 3. CHANGELOG entry exists for that version?
grep -E "^## \[?$(node -p 'require(\"./package.json\").version')\]?" CHANGELOG.md

# 4. Tarball still ships the expected files (catches `files` regressions)?
pnpm pack --pack-destination /tmp >/dev/null
tar tzf /tmp/dojocoding-whatsapp-*.tgz | sort
```

If any of those fails the check, fix it on `main`, wait for CI,
THEN tag.

## What `release.yml` actually does (so you understand what gates it)

`/.github/workflows/release.yml`:

- Triggers on `push: tags: ["v*.*.*"]`.
- Verifies `package.json.version === tag without "v" prefix`. Fails fast otherwise.
- Verifies `CHANGELOG.md` contains a `## [tag]` heading. Fails fast otherwise.
- Runs `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`.
- `pnpm publish --provenance --access public` (requires `NPM_TOKEN` secret + `id-token: write` permission for OIDC).
- Creates a GitHub Release whose body is the new CHANGELOG section.

A green release run produces:
- A new version on `registry.npmjs.org/@dojocoding/whatsapp` with provenance attestation.
- A new GitHub Release at `github.com/DojoCodingLabs/whatsapp-adapter/releases/tag/vX.Y.Z`.

## Recovery from a botched tag

| Situation                                                                 | Recovery                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tag pushed, release workflow failed BEFORE publish (no npm, no Release)   | Safe to move the tag. Confirm with the user, then: `git tag -d vX.Y.Z && git push --delete origin vX.Y.Z`, commit the fix, wait for CI green, re-tag at the new SHA, push.                                                              |
| Tag pushed, release workflow succeeded (npm has X.Y.Z, GH Release exists) | **Do not move the tag.** Burn the version. Bump to `X.Y.Z+1`, fix-forward, re-release.                                                                                                                                                  |
| Wrong commit was tagged but neither npm nor Release published yet         | Same as the first row — safe to move.                                                                                                                                                                                                   |
| Test was flaky and just needs a retry                                     | Re-run the workflow via `gh run rerun <id>`. Only do this if the flake is benign (timing-dependent, no signal of an actual bug). If the test is genuinely flaky on CI but green locally, that's a test bug — fix the test, don't retry. |

Moving an already-published-to-npm tag is **not** in this list because
npm `unpublish` has a 72-hour window and breaks any consumer that
installed the bad version. Pretend the registry is immutable.

## When this skill is REQUIRED

Invoke this skill BEFORE:

- Running `git tag -a v*.*.*` in this repo.
- Running `git push origin v*.*.*` for a version tag.
- Editing `package.json` `version` field.
- The user says: "ship X.Y.Z", "release X.Y.Z", "publish X.Y.Z",
  "tag vX.Y.Z", "cut a release", "let's release", "let's push X.Y.Z
  to npm".

## When this skill does NOT apply

- Non-release tags (e.g. `milestone-2026-Q2`, `audit-snapshot-2026-05`).
- Pushing non-version commits to `main`.
- Local development / branch work that doesn't involve a tag.
- Discussing release strategy without acting on it.

## Failure mode this skill prevents

**2026-05-10 incident (this is exactly what we want to avoid):** a
version-bump commit was pushed to main and `git tag v0.2.0` was
issued in the same shell session, without waiting for CI on the
version-bump commit. CI then found a flaky test, the release workflow
failed, and the `v0.2.0` tag pointed at a known-broken SHA. Recovery
required deleting + re-pushing the tag after a fix landed — a
destructive operation that's only safe because no consumer had
installed `0.2.0` from npm.

Tag, then CI: **fast and wrong.** CI, then tag: **the contract above.**
