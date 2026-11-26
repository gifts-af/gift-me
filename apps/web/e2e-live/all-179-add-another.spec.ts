import { expect, test } from "@playwright/test";

// ALL-179 on production: a user added someone, opened Add again and found the
// last person still filled in, with Save stuck. Next keeps a left page alive,
// so the form now clears once a save succeeds. This adds one person and
// deletes them again. Run with
// `pnpm live-check e2e-live/all-179-add-another.spec.ts`.
test("after adding someone, Add starts empty with a working button", async ({ page }) => {
  const person = `Live check ${Date.now()}`;
  await page.goto("/people/new");
  await expect(page.getByRole("button", { name: "Add someone" })).toBeEnabled();
  await page.getByLabel("Name").fill(person);
  await page.getByLabel("Who are they to you?").selectOption({ label: "Mother" });
  await page.getByRole("button", { name: `Add ${person}` }).click();
  await expect(page).toHaveURL(/\/give$/);

  try {
    // In-app navigation, as a person would: the kept page comes back.
    await page.getByRole("link", { name: "Add someone you buy for" }).click();
    await expect(page).toHaveURL(/\/people\/new$/);
    await expect(page.getByLabel("Name")).toHaveValue("");
    await expect(page.getByLabel("Who are they to you?")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Add someone" })).toBeEnabled();
  } finally {
    await page.goto("/give");
    await page.getByRole("link", { name: person, exact: true }).click();
    await page.getByRole("button", { name: /^Delete Live check/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/give$/);
  }
});
