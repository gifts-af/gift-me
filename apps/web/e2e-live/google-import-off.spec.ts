import { expect, test } from "@playwright/test";

// Google import is off (google_import_enabled = 0), so Import says to add people by hand and
// offers no Connect button. Read-only. Run with
// `pnpm live-check e2e-live/google-import-off.spec.ts`. Turning import back on: design/operations.md >
// Concierge access.
test("Import says it's off, and to add people by hand", async ({ page }) => {
  await page.goto("/people/import");
  await expect(page.getByText("Google import is off for now.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add people by hand." })).toHaveAttribute("href", "/people/new");
  await expect(page.getByRole("button", { name: "Connect Google Contacts" })).toHaveCount(0);
});
