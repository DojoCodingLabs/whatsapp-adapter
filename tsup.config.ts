import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "adapters/express/index": "src/adapters/express/index.ts",
    "adapters/web/index": "src/adapters/web/index.ts",
    "adapters/hono/index": "src/adapters/hono/index.ts",
    "storage/redis": "src/storage/redis.ts",
    "storage/postgres": "src/storage/postgres.ts",
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
  // Express is a peer dependency for users of the `/express` subpath only;
  // bundling it would (a) ship a megabyte of dead weight to non-Express
  // users and (b) break module identity for consumers who import Express
  // themselves. Keep it external.
  external: ["express", "hono", "ioredis", "pg"],
});
