import { defineConfig, devices } from "@playwright/test";

// Checks on the real giftsaf.com, signed in as the shared test account. Run them
// with `pnpm live-check`, which provides the session (README > Production test
// account). One at a time, to stay light on production. Traces are off because
// they'd record the session's cookies.
const storageState = process.env.LIVE_CHECK_STATE;
if (!storageState) throw new Error("Run this with `pnpm live-check`, which signs in first.");

export default defineConfig({
  testDir: "./e2e-live",
  outputDir: "./test-results/live",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "https://giftsaf.com",
    storageState,
    trace: "off",
  },
  projects: [
    { name: "android", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
