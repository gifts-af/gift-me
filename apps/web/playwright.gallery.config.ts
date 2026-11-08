import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// The screen gallery (ALL-000): `pnpm gallery` screenshots the main screens and
// every email against the local Supabase, then writes gallery/index.html to
// review them in one place. It reuses the browser tests' server and test
// accounts, but it isn't a test: it checks nothing and never runs in CI.
export default defineConfig({
  ...base,
  testMatch: "gallery.shots.ts",
  globalSetup: "./e2e/gallery-setup.ts",
  globalTeardown: "./e2e/gallery-index.ts",
  outputDir: "./gallery/.playwright",
  retries: 0,
  reporter: "list",
  projects: [
    { name: "phone", use: { ...devices["iPhone 13 Mini"], viewport: { width: 375, height: 812 }, colorScheme: "light" } },
    { name: "phone-dark", use: { ...devices["iPhone 13 Mini"], viewport: { width: 375, height: 812 }, colorScheme: "dark" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, colorScheme: "light" } },
  ],
});
