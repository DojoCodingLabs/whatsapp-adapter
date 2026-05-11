import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
    environment: "node",
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    // Phase C0 ships a package skeleton with no test files yet.
    // Phase C1 fills in unit + contract tests.
    passWithNoTests: true,
  },
});
