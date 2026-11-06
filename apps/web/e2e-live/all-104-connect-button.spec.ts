import { expect, test } from "@playwright/test";

// ALL-104: "Connect Google Contacts" looks not ready until the page can respond.
// Read-only, and it never taps the button, so nothing opens Google's prompt. Run
// with `pnpm live-check e2e-live/all-104-connect-button.spec.ts`.
const button = { name: "Connect Google Contacts" };

test("it's marked not ready while the page's scripts haven't loaded", async ({ page }) => {
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.goto("/people/import");
  await expect(page.getByRole("button", button)).toHaveAttribute("aria-disabled", "true");
});

test("it's ready once the page's scripts have loaded", async ({ page }) => {
  await page.goto("/people/import");
  await expect(page.getByRole("button", button)).toHaveAttribute("aria-disabled", "false");
});
