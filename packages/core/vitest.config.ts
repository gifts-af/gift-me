import { defineConfig } from "vitest/config";

// Core holds the rules money and deadlines depend on, so it keeps 90%+
// coverage (ALL-19 acceptance criteria).
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/database.types.ts"],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
