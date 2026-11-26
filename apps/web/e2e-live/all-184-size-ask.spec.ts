import { expect, test, type Page } from "@playwright/test";

// ALL-184 on production: adding a gift that needs a size you haven't saved asks
// for it, and "Save and share" saves it shared. The shared account starts with
// no sizes, so this saves one and removes it again, with the gift. Run with
// `pnpm live-check e2e-live/all-184-size-ask.spec.ts`.

const status = (page: Page) => page.getByRole("status", { name: "Save status" });

test("adding a shirt asks for the shirt size, and saving shares it", async ({ page }) => {
  const gift = `Live check Flannel Shirt ${Date.now()}`;
  await page.goto("/lists");
  await page.getByRole("button", { name: "Add by hand" }).click();
  await page.getByLabel("Gift name").fill(gift);
  await page.getByLabel("Price").fill("20");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByRole("heading", { name: gift })).toBeVisible();
  await expect(status(page)).toHaveText("Saved");

  try {
    const card = page.getByRole("region", { name: "Add your shirt or top size?" });
    await expect(card).toBeVisible();
    await card.getByLabel("Shirt or top size").fill("M");
    await card.getByRole("button", { name: "Save and share" }).click();
    await expect(page.getByText(/^Saved and shared\. Anyone with your list link will see your shirt or top size/)).toBeVisible();

    await page.goto("/settings/sizes");
    await expect(page.getByLabel("Shirt or top", { exact: true })).toHaveValue("M");
    await expect(page.getByRole("switch", { name: "Share Shirt or top" })).toBeChecked();
  } finally {
    await page.goto("/settings/sizes");
    // Wait for the form, so a saved size's Remove all has had time to show.
    await expect(page.getByLabel("Shirt or top", { exact: true })).toBeVisible();
    const removeAll = page.getByRole("button", { name: "Remove all" });
    if (await removeAll.isVisible()) {
      await removeAll.click();
      await expect(page.getByRole("status").filter({ hasText: /^Removed$/ })).toBeVisible();
    }
    await page.goto("/lists");
    await page.getByRole("button", { name: new RegExp(`Remove ${gift}`) }).click();
    await page.getByRole("heading", { level: 1, name: "My list" }).focus();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0, { timeout: 15_000 });
    await expect(status(page)).toHaveText("Saved");
  }
});
