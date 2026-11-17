import { expect, test } from "@playwright/test";
test.use({ viewport: { width: 375, height: 480 } });
const out = process.env.SHOT_DIR!;
const tag = process.env.SHOT_TAG!;
test("shots", async ({ page }) => {
  await page.goto("/settings");
  const link = page.getByRole("link", { name: /^Zinc/ });
  await link.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/all131-${tag}-1-scrolled.png` });
  await link.click();
  await expect(page).toHaveURL(/\/settings\/paying$/);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/all131-${tag}-2-back.png` });
});
