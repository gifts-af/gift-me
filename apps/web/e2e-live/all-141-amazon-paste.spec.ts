import { expect, test, type Page } from "@playwright/test";

// ALL-141 and ALL-188: pasting an Amazon link and tapping Add once puts the
// real name, price and photo from Zinc on the list (1¢ on the app's Zinc key).
// The gift is removed again, so the list is left as it was. Run with
// `pnpm live-check e2e-live/all-141-amazon-paste.spec.ts`. It names one real
// listing ("SOULWIT", ASIN B0G5Z36T3N): if Amazon renames or removes it, swap in
// another product rather than reading the failure as a regression.

const card = (page: Page) => page.locator("article").filter({ hasText: /SOULWIT/ });

// Removes the gift if it's there. The Undo window waits while Undo is hovered
// or focused (T74), so both move away; the remove is sent once Undo goes.
async function removeGift(page: Page) {
  await page.goto("/lists");
  while ((await card(page).count()) > 0) {
    await card(page).first().getByRole("button", { name: /remove/i }).click();
    await page.mouse.move(0, 0);
    await page.getByRole("heading", { level: 1, name: "My list" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0, { timeout: 30_000 });
  }
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved", { timeout: 20_000 });
}

test.afterEach(async ({ page }) => removeGift(page));

test("one tap on Add puts the real Amazon product on the list", async ({ page }) => {
  await page.goto("/lists");
  await page.getByLabel("Paste a link").fill("https://www.amazon.com/dp/B0G5Z36T3N?th=1");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/^Added SOULWIT.* to your list\.$/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Paste a link")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Add to list" })).toHaveCount(0);
  await expect(card(page)).toHaveCount(1);
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved", { timeout: 20_000 });
  const photo = card(page).locator('img[src*="m.media-amazon.com/images/I/"]').first();
  await expect(photo).toBeVisible();
  // Loaded for real, not the 1x1 the old ASIN shortcut returned.
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(1);
  await page.screenshot({ path: test.info().outputPath("amazon-paste.png") });
});
