import { expect, test, type Page } from "@playwright/test";

// ALL-131 on production: "‹ Name" and "‹ Settings" bring you back to where
// you were, with focus on the row you opened. The shared account keeps no
// people it didn't have, so the person check adds its own and deletes it.
// Run with `pnpm live-check e2e-live/all-131-back-keeps-place.spec.ts`.
test.use({ viewport: { width: 375, height: 480 } });

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

async function openAndComeBack(page: Page, row: RegExp, back: string) {
  const link = page.getByRole("link", { name: row });
  await link.scrollIntoViewIfNeeded();
  const before = await scrollY(page);
  expect(before).toBeGreaterThan(0);
  const from = page.url();
  await link.click();
  await expect(page).not.toHaveURL(from);
  await page.getByRole("link", { name: back, exact: true }).click();
  await expect(page).toHaveURL(from);
  await expect(link).toBeFocused();
  await expect.poll(() => scrollY(page)).toBeGreaterThanOrEqual(before - 2);
}

test("back from Settings keeps your place", async ({ page }) => {
  await page.goto("/settings");
  await openAndComeBack(page, /^Zinc/, "Settings");
});

test("back from a person's address keeps your place on their page", async ({ page }) => {
  const person = `Live check ${Date.now()}`;
  await page.goto("/people/new");
  await expect(page.getByRole("button", { name: "Add someone" })).toBeEnabled();
  await page.getByLabel("Name").fill(person);
  await page.getByLabel("Who are they to you?").selectOption({ label: "Mother" });
  await page.getByRole("button", { name: `Add ${person}` }).click();
  await expect(page).toHaveURL(/\/give$/);
  await page.getByRole("link", { name: person, exact: true }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  const personUrl = page.url();

  try {
    await openAndComeBack(page, /^Shipping address/, person);
  } finally {
    await page.goto(personUrl);
    await page.getByRole("button", { name: /^Delete Live check/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/give$/);
  }
});
