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
    dts: true,
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
