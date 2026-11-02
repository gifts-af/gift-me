import { defineConfig, devices } from "@playwright/test";
import { localSupabase } from "./e2e/local-supabase";

// Browser tests (ALL-20). They need the local Supabase running
// (`pnpm supabase start`). CI builds the app first and serves the build;
// locally an already running `pnpm dev` is reused (stop it first if it wasn't
// started with SUPABASE_SECRET_KEY set to the local service key).
const supabase = localSupabase();
const port = 3100;
const CI = Boolean(process.env.CI);
// Cloudflare's published Turnstile test keys (ALL-68): the widget always
// passes and its dummy token always verifies. CI's build gets the site key
// from the workflow, since NEXT_PUBLIC_ values are fixed at build time.
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  // Every test runs on two phones (ALL-60): an Android phone in Chromium and
  // an iPhone in WebKit, Safari's engine (iPhone Mail uses it too). Both at
  // 375 px wide, because the acceptance criterion is "usable at 375 px".
  // App tests also run in desktop Chrome; emails are only read on phones here.
  projects: [
    { name: "android", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } },
    { name: "iphone", use: { ...devices["iPhone 13 Mini"], viewport: { width: 375, height: 812 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }, testIgnore: /emails\.spec\.ts/ },
  ],
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
          // Server-only: the /a/{token} action links read and use links with it (ALL-23).
          SUPABASE_SECRET_KEY: supabase.serviceRoleKey,
          NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
          TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
          // Any value: contacts-import.spec.ts replaces Google's sign-in script (ALL-24).
          NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "e2e-fake-client-id",
        },
      },
});
