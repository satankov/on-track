import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    globals: true,
    // Shared CI runners must not overlap fsync-heavy SQLite/restore suites with
    // native PowerShell ACL subprocesses. Explicit in-test concurrency remains.
    fileParallelism: !process.env.CI,
    // Native Windows ACL verification invokes PowerShell at filesystem boundaries.
    testTimeout: process.platform === "win32" ? 30_000 : 5_000,
    hookTimeout: process.platform === "win32" ? 30_000 : 10_000,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/domain/**/*.ts",
        "src/server/**/*.ts",
        "src/client/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.test.*",
        "src/server/main.ts",
        "src/client/main.tsx",
        "src/server/db/schema.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
