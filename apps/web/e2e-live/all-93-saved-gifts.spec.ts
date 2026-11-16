import { expect, test } from "@playwright/test";

// ALL-93: saved gifts on a person's page, on production. The shared account
// keeps no people, so it adds one, saves a gift by hand, checks it survives a
// reload, removes it, then deletes the person: nothing is left behind. Run
// with `pnpm live-check e2e-live/all-93-saved-gifts.spec.ts`.
test("save a gift for someone, then remove it", async ({ page }) => {
  const stamp = Date.now();
  const person = `Live check ${stamp}`;
  await page.goto("/people/new");
  await expect(page.getByRole("button", { name: "Add someone" })).toBeEnabled();
  await page.getByLabel("Name").fill(person);
  await page.getByLabel("Who are they to you?").selectOption({ label: "Mother" });
  await page.getByRole("button", { name: `Add ${person}` }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: person, exact: true }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);

  try {
    const saved = page.getByRole("region", { name: "Saved gifts" });
    await expect(saved.getByText(/^Only you see these\./)).toBeVisible();
    await expect(page.getByText("You don't need their list to buy for them.")).toBeVisible();
    await expect(saved.getByRole("button", { name: "Save" })).toBeEnabled();

    const gift = `Gift ${stamp}`;
    await saved.getByLabel("Gift").fill(gift);
    await saved.getByLabel("Price").fill("12");
    await saved.getByRole("button", { name: "Save" }).click();
    await expect(saved.getByText(gift)).toBeVisible();

    await page.reload();
    await expect(saved.getByRole("listitem").filter({ hasText: gift })).toContainText("$12.00");

    await saved.getByRole("button", { name: `Remove ${gift}` }).click();
    await expect(saved.getByText(gift)).toHaveCount(0);
    await page.reload();
    await expect(saved.getByText(gift)).toHaveCount(0);
  } finally {
    await page.getByRole("button", { name: `Delete ${person}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  }
});
