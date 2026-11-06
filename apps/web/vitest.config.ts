import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Tests that use the real local database (E5) share its app_settings switches
// (zinc_ordering_enabled, round_engine_enabled), which some of them flip. They
// run one file at a time, after the rest, so one file's switch can't change
// another's run (ALL-32).
const LOCAL_DB_TESTS = [
  "modules/concierge/__tests__/placing-race.test.ts",
  "modules/concierge/__tests__/purchase.test.ts",
  "modules/concierge/__tests__/round-engine.test.ts",
  "modules/concierge/__tests__/zinc-connect.test.ts",
  "modules/concierge/__tests__/zinc-events.test.ts",
];
const EXCLUDE = ["node_modules", ".next", "scripts", "e2e", "e2e-live"];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/*.{test,spec}.{js,jsx,ts,tsx}"],
          exclude: [...EXCLUDE, ...LOCAL_DB_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: "local-db",
          include: LOCAL_DB_TESTS,
          exclude: EXCLUDE,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
