import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Local mirror of the CI "Verify pack contents (dry-run)" step. Same
 * assertion logic against the actual tarball pnpm pack produces.
 *
 * This catches `files` allowlist drift BEFORE the change reaches CI:
 * a missing dist artefact (e.g. forgot to add a new tsup entry) or
 * an accidentally-shipped source / test / openspec file produces a
 * local failure during `pnpm test`.
 *
 * Slow-ish (5-10s per run due to `pnpm pack`), so it lives in
 * `test/contract/` and not in the inner unit-test loop.
 */

const REQUIRED_ENTRIES = [
  "package/LICENSE",
  "package/README.md",
  "package/CHANGELOG.md",
  "package/package.json",
  "package/dist/index.js",
  "package/dist/index.cjs",
  "package/dist/index.d.ts",
  "package/dist/adapters/express/index.js",
  "package/dist/adapters/express/index.cjs",
  "package/dist/adapters/express/index.d.ts",
  "package/dist/adapters/web/index.js",
  "package/dist/adapters/web/index.cjs",
  "package/dist/adapters/web/index.d.ts",
  "package/dist/adapters/hono/index.js",
  "package/dist/adapters/hono/index.cjs",
  "package/dist/adapters/hono/index.d.ts",
  "package/dist/storage/redis.js",
  "package/dist/storage/redis.cjs",
  "package/dist/storage/redis.d.ts",
  "package/dist/storage/postgres.js",
  "package/dist/storage/postgres.cjs",
  "package/dist/storage/postgres.d.ts",
] as const;

const FORBIDDEN_PREFIXES = [
  "package/src",
  "package/test",
  "package/coverage",
  "package/node_modules",
  "package/.github",
  "package/openspec",
] as const;

const REPO_ROOT = join(import.meta.dirname, "..", "..");

let tarballPath: string;
let tempDir: string;
let entries: string[];

beforeAll(() => {
  // If dist/ is missing (e.g. CI runs tests before build, or a fresh
  // clone hasn't run `pnpm build` yet), run the build first.
  // Otherwise pack against whatever the current dist tree looks like.
  if (!existsSync(join(REPO_ROOT, "dist", "index.js"))) {
    execFileSync("pnpm", ["build"], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  }
  tempDir = mkdtempSync(join(tmpdir(), "whatsapp-pack-test-"));
  // Run `pnpm pack` with --pack-destination. Note: pnpm runs
  // `prepublishOnly` for `pnpm pack` by default — which would
  // recursively invoke vitest from inside this test. We skip it via
  // the `npm_config_ignore_scripts=true` env var (pnpm respects the
  // same envs as npm). The full prepublishOnly path runs on every
  // CI build via the actual release workflow.
  execFileSync("pnpm", ["pack", "--pack-destination", tempDir], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: { ...process.env, npm_config_ignore_scripts: "true" },
  });
  const files = readdirSync(tempDir).filter((f) => f.endsWith(".tgz"));
  if (files.length !== 1) {
    throw new Error(`Expected exactly 1 .tgz in ${tempDir}, got ${files.length}`);
  }
  tarballPath = join(tempDir, files[0]!);
  const listing = execFileSync("tar", ["tzf", tarballPath], {
    encoding: "utf8",
  }).trim();
  entries = listing
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}, 60_000);

afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("pnpm pack contents (local mirror of CI assertion)", () => {
  for (const required of REQUIRED_ENTRIES) {
    it(`includes \`${required}\``, () => {
      expect(entries).toContain(required);
    });
  }

  for (const forbidden of FORBIDDEN_PREFIXES) {
    it(`does NOT ship anything under \`${forbidden}\``, () => {
      const leaked = entries.filter((e) => e.startsWith(forbidden));
      expect(leaked, `Forbidden tarball entries under ${forbidden}: ${leaked.join(", ")}`).toEqual(
        []
      );
    });
  }
});
