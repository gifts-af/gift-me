import { expect, test } from "@playwright/test";

// ALL-120: a base budget on production. The shared account keeps no people,
// so it adds one, sets a $75 base and a $50 Mother's Day, checks the Budget
// row, clears the base, then deletes the person: nothing is left behind. Run
// with `pnpm live-check e2e-live/all-120-base-budget.spec.ts`.
test("set a base budget, see the row, clear it", async ({ page }) => {
  const person = `Live check ${Date.now()}`;
  await page.goto("/people/new");
  await expect(page.getByRole("button", { name: "Add someone" })).toBeEnabled();
  await page.getByLabel("Name").fill(person);
  await page.getByLabel("Who are they to you?").selectOption({ label: "Mother" });
  await page.getByRole("button", { name: `Add ${person}` }).click();
  await expect(page).toHaveURL(/\/give$/);
  await page.getByRole("link", { name: person, exact: true }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);

  try {
    const row = page.getByRole("link", { name: /^Budget/ });
    await expect(row).toContainText("Not set");

    await row.click();
    await expect(page).toHaveURL(/\/budget$/);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await page.getByRole("textbox", { name: "Any occasion" }).fill("75");
    await page.getByRole("textbox", { name: "Mother's Day" }).fill("50");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
    await expect(row).toContainText("$75 · Mother's Day $50");

    await row.click();
    await expect(page).toHaveURL(/\/budget$/);
    await expect(page.getByRole("textbox", { name: "Christmas" })).toHaveAttribute("placeholder", "Uses $75");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await page.getByRole("textbox", { name: "Any occasion" }).fill("");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
    await expect(row).toContainText("Mother's Day $50");
    await expect(row).not.toContainText("$75");
  } finally {
    await page.getByRole("button", { name: `Delete ${person}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/give$/);
  }
});
