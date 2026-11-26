import { chmod } from "node:fs/promises";
import { resolve } from "node:path";

import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    outDir: "dist",
    target: "node20",
    platform: "node",
    // tsup 8's declaration build injects `baseUrl`, which TypeScript 6
    // deprecates (TS5101). Silence only that, only for the dts pass; the
    // project tsconfig stays strict. Remove when moving to tsup 9 (needs
    // Node >=22.18, i.e. after the Node 20 floor is dropped).
    dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
    sourcemap: false,
    clean: true,
    splitting: false,
    treeshake: true,
    minify: false,
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    outDir: "dist",
    target: "node20",
    platform: "node",
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    treeshake: true,
    minify: false,
    banner: { js: "#!/usr/bin/env node" },
    async onSuccess() {
      await chmod(resolve("dist", "cli.js"), 0o755);
    },
  },
]);
