import { expect, test } from "@playwright/test";

// ALL-141: pasting an Amazon link fills the real name, price and photo from
// Zinc. It only looks the link up (1¢ on the app's Zinc key) and never adds the
// gift, so the list is left as it was. Run with
// `pnpm live-check e2e-live/all-141-amazon-paste.spec.ts`. It names one real
// listing ("SOULWIT", ASIN B0G5Z36T3N): if Amazon renames or removes it, swap in
// another product rather than reading the failure as a regression.
test("an Amazon link fills the real product from Zinc", async ({ page }) => {
  await page.goto("/lists");
  await page.getByLabel("Paste a link").fill("https://www.amazon.com/dp/B0G5Z36T3N?th=1");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Found it. Check the details, then add it.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/SOULWIT/).first()).toBeVisible();
  await expect(page.getByText(/· found on Amazon/)).toBeVisible();
  const photo = page.locator('img[src*="m.media-amazon.com/images/I/"]').first();
  await expect(photo).toBeVisible();
  // Loaded for real, not the 1x1 the old ASIN shortcut returned.
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(1);
  await page.screenshot({ path: test.info().outputPath("amazon-paste.png") });
});
