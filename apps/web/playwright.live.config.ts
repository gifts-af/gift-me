import { defineConfig, devices } from "@playwright/test";

// Checks on the real giftsaf.com, signed in as the shared test account. Run them
// with `pnpm live-check`, which provides the session (design/operations.md > Production test
// account). One at a time, to stay light on production. Traces are off because
// they'd record the session's cookies.
const storageState = process.env.LIVE_CHECK_STATE;
const baseURL = process.env.LIVE_CHECK_BASE_URL;
if (!storageState || !baseURL) throw new Error("Run this with `pnpm live-check`, which signs in first.");

export default defineConfig({
  testDir: "./e2e-live",
  outputDir: "./test-results/live",
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    storageState,
    trace: "off",
  },
  projects: [
    { name: "android", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
