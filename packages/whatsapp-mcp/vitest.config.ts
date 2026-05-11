import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
    environment: "node",
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    // Phase C0 shipped a package skeleton with no test files; Phase C1
    // populated the suite. Keep `passWithNoTests` so a future scaffold
    // refactor that temporarily empties a test folder doesn't fail CI.
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        // Bin entry — only exercised via spawn-the-bin E2E
        // (`WHATSAPP_MCP_E2E=1`). The unit + contract suite never
        // imports it.
        "src/cli.ts",
        // Barrel re-exports — no executable code.
        "src/index.ts",
      ],
      thresholds: {
        // Coverage shape post-exclusion (May 2026, after targeted
        // branch tests landed):
        //   statements 98.6, branches 72.0, functions 100, lines 98.6
        //
        // Branch coverage is below the SDK's 85 because each tool
        // file conditionally spreads optional zod fields
        // (`...(x !== undefined ? { x } : {})`) — both spread paths
        // need a happy-path test to cover both branches. Targeted
        // tests for high-value branches (the `!link && !id` media
        // validation, replyTo passthrough, list-templates filters)
        // moved branches from 64 → 72; the remaining ~22 conditional
        // spreads are mechanical idioms with near-zero
        // bug-catching value and aren't worth ~20 more tests.
        statements: 95,
        branches: 65,
        functions: 95,
        lines: 95,
      },
    },
  },
});
