import { expect, test } from "@playwright/test";

// ALL-32: read-only check that Settings shows "Paying for gifts" on giftsaf.com
// for the shared test account, renders one of its states, and never the
// load-failure line. Buys nothing, connects nothing.
test("Settings shows the Paying for gifts section", async ({ page }) => {
  await page.goto("/settings/paying");
  // The page title is the h1; the section's own h2 says "Paying for gifts" too, or "Connect Zinc" while waiting.
  await expect(page.getByRole("heading", { level: 1, name: "Paying for gifts" })).toBeVisible();
  const section = page.locator('section[aria-labelledby="paying-heading"]');
  await expect(section).toBeVisible();
  await expect(section).not.toContainText("Couldn't load");
  const text = (await section.innerText()).replace(/\s+/g, " ");
  test.info().annotations.push({ type: "state", description: text.slice(0, 200) });
  console.log(`Paying for gifts state: ${text.slice(0, 200)}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
