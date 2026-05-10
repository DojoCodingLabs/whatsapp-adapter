import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "adapters/express/index": "src/adapters/express/index.ts",
  },
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
  shims: false,
});
