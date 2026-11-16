import { expect, test } from "@playwright/test";

// ALL-109 and ALL-121: the add form's new layout and the in-laws. Read-only:
// it opens the form and saves nothing. Run with
// `pnpm live-check e2e-live/all-109-person-form.spec.ts`.
test("the add form has the Dates card and the in-laws", async ({ page }) => {
  await page.goto("/people/new");
  await expect(page.getByRole("heading", { level: 2, name: "Dates" })).toBeVisible();
  await expect(page.getByText("Optional")).toHaveCount(1);
  const picker = page.getByLabel("Who are they to you?");
  for (const label of ["Mother-in-law", "Father-in-law", "Sister-in-law", "Brother-in-law", "Daughter-in-law", "Son-in-law"]) {
    await expect(picker.getByRole("option", { name: label })).toHaveCount(1);
  }
});
