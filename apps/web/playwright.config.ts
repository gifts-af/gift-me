import { defineConfig } from "@playwright/test";
import { localSupabase } from "./e2e/local-supabase";

// Browser tests (ALL-20). They need the local Supabase running
// (`pnpm supabase start`). CI builds the app first and serves the build;
// locally an already running `pnpm dev` is reused.
const supabase = localSupabase();
const port = 3100;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${port}`,
    // A phone: the acceptance criterion is "usable at 375 px".
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: CI ? `pnpm start --port ${port}` : `pnpm dev --port ${port}`,
        url: `http://localhost:${port}/auth/login`,
        reuseExistingServer: !CI,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: supabase.url,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
        },
      },
});
