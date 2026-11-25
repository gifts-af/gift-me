import { expect, test } from "@playwright/test";

// Google import is off (google_import_enabled = 0), so Import says to add people by hand and
// offers no Connect button. Read-only. Run with
// `pnpm live-check e2e-live/all-104-connect-button.spec.ts`. Once the setting is 1, the button's
// own check (it looks not ready until the page can respond) is in this file's history.
test("Import says it's off, and to add people by hand", async ({ page }) => {
  await page.goto("/people/import");
  await expect(page.getByText("Google import is off for now.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add people by hand." })).toHaveAttribute("href", "/people/new");
  await expect(page.getByRole("button", { name: "Connect Google Contacts" })).toHaveCount(0);
});
