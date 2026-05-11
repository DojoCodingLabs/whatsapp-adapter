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
        // Coverage shape post-exclusion (May 2026):
        //   statements 99, branches 64, functions 97, lines 99
        // Branch coverage is lower than the SDK's 85 because each
        // tool file conditionally spreads optional zod fields
        // (`...(x !== undefined ? { x } : {})`) — both spread paths
        // need a happy-path test to cover both branches. We accept
        // the lower threshold here; tightening to 80 would require
        // ~12 additional optional-field tests across the tool files.
        statements: 95,
        branches: 60,
        functions: 95,
        lines: 95,
      },
    },
  },
});
