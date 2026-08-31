import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    globals: true,
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
