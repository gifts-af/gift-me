import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Tests that use the real local database (E5) share its app_settings switches
// (zinc_ordering_enabled, round_engine_enabled), which some of them flip. They
// run one file at a time, after the rest, so one file's switch can't change
// another's run (ALL-32).
const LOCAL_DB_TESTS = [
  "modules/concierge/__tests__/code-columns-db.test.ts",
  "lib/__tests__/wiring.test.ts",
  "modules/concierge/__tests__/add-from-link.test.ts",
  "modules/concierge/__tests__/approval-db.test.ts",
  "modules/concierge/__tests__/capture-store-scope.test.ts",
  "modules/concierge/__tests__/fanout-db.test.ts",
  "modules/concierge/__tests__/idea-daily-limit.test.ts",
  "modules/concierge/__tests__/idea-store.test.ts",
  "modules/concierge/__tests__/inbound-store.test.ts",
  "modules/concierge/__tests__/notify-store.test.ts",
  "modules/concierge/__tests__/placing-race.test.ts",
  "modules/concierge/__tests__/purchase.test.ts",
  "modules/concierge/__tests__/replace.test.ts",
  "modules/concierge/__tests__/round-engine-held-address.test.ts",
  "modules/concierge/__tests__/round-engine-held-failures.test.ts",
  "modules/concierge/__tests__/round-engine-held-holds.test.ts",
  "modules/concierge/__tests__/zinc-connect.test.ts",
  "modules/concierge/__tests__/zinc-events.test.ts",
  "modules/lists/__tests__/add-item-db.test.ts",
  "modules/lists/__tests__/amazon-lookup-db.test.ts",
  "modules/lists/__tests__/person-link.test.ts",
  "modules/lists/__tests__/save-list.test.ts",
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
    // Logic tests run in plain Node; only component tests (.tsx, .jsx) pay for the fake
    // browser and its setup file. A .ts test that needs a browser says `@vitest-environment jsdom`.
    environment: "node",
    globals: true,
    pool: "threads",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/*.{test,spec}.{js,ts}"],
          exclude: [...EXCLUDE, ...LOCAL_DB_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: "unit-dom",
          environment: "jsdom",
          setupFiles: ["./test/setup.ts"],
          include: ["**/*.{test,spec}.{jsx,tsx}"],
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
