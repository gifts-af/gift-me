import { expect, test, type Page } from "@playwright/test";

// ALL-127 on production: About saves each field as you go, and My list saves
// adds and removes with Undo, refusing a stale tab. The shared account keeps
// no people and no gifts it didn't have, so both checks add their own and
// remove them again. Run with
// `pnpm live-check e2e-live/all-127-save-as-you-go.spec.ts`.

test("About saves the name, relationship and birthday as you go", async ({ page }) => {
  const person = `Live check ${Date.now()}`;
  await page.goto("/people/new");
  await expect(page.getByRole("button", { name: "Add someone" })).toBeEnabled();
  await page.getByLabel("Name").fill(person);
  await page.getByLabel("Who are they to you?").selectOption({ label: "Mother" });
  await page.getByRole("button", { name: `Add ${person}` }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: person, exact: true }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  const personUrl = page.url();
  const renamed = `${person} B`;

  try {
    await page.getByRole("link", { name: new RegExp(`^About ${person}`) }).click();
    await expect(page).toHaveURL(/\/about$/);
    const name = page.getByRole("textbox", { name: "Name" });
    await expect(name).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);

    await name.fill(renamed);
    await name.press("Tab");
    await expect(page.getByTestId("name-field").getByRole("status")).toHaveText("Saved");

    const relationship = page.getByRole("combobox", { name: "Who are they to you?" });
    await relationship.selectOption({ label: "Aunt" });
    await expect(relationship.locator("xpath=../..").getByRole("status")).toHaveText("Saved");

    const birthday = page.getByRole("group", { name: "Birthday" });
    await birthday.getByRole("combobox", { name: "Birthday month" }).selectOption({ label: "November" });
    await birthday.getByRole("spinbutton", { name: "Birthday day" }).fill("30");
    await name.click();
    await expect(birthday.getByRole("status")).toHaveText("Saved");

    // After a reload, everything is still there.
    await page.goto(personUrl);
    await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`^About ${renamed}`) })).toContainText("Aunt · Birthday Nov 30");
    for (const row of [/^Budget/, /^Saved gifts/, /^Their list/, /^Shipping address/]) {
      await expect(page.getByRole("link", { name: row })).toBeVisible();
    }
  } finally {
    await page.goto(personUrl);
    const del = page.getByRole("button", { name: /^Delete Live check/ });
    await del.click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  }
});

const saveStatus = (page: Page) => page.getByRole("status", { name: "Save status" });
const gift = (page: Page, name: string) => page.getByRole("heading", { level: 3, name, exact: true });

async function addGift(page: Page, name: string) {
  await page.getByRole("button", { name: "Add by hand" }).click();
  await page.getByLabel("Gift name").fill(name);
  await page.getByLabel("Price").fill("12");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(gift(page, name)).toBeVisible();
}

test("My list saves an add, Undo keeps a gift, and a stale tab can't overwrite it", async ({ page, context }) => {
  const one = `Live check A ${Date.now()}`;
  const two = `Live check B ${Date.now()}`;
  await page.goto("/lists");
  await expect(page.getByRole("button", { name: "Add by hand" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

  await addGift(page, one);
  await expect(saveStatus(page)).toHaveText("Saved");

  try {
    // Undo puts it back, and it's still there after a reload.
    await page.getByRole("button", { name: `Remove ${one} from your list` }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeFocused();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(gift(page, one)).toBeVisible();
    await page.reload();
    await expect(gift(page, one)).toBeVisible();

    // A second tab opened now goes stale once this one saves.
    const stale = await context.newPage();
    await stale.goto("/lists");
    await expect(gift(stale, one)).toBeVisible();
    await addGift(page, two);
    await expect(saveStatus(page)).toHaveText("Saved");

    // The stale tab's remove is refused, then merged on top of the latest list.
    await stale.getByRole("button", { name: `Remove ${one} from your list` }).click();
    await stale.getByRole("heading", { level: 1, name: "My list" }).click();
    await expect(stale.getByText("Your list changed somewhere else. We've loaded the latest.")).toBeVisible({ timeout: 15_000 });
    await expect(gift(stale, two)).toBeVisible();
    await expect(gift(stale, one)).toHaveCount(0);
    await stale.close();

    await page.reload();
    await expect(gift(page, two)).toBeVisible();
    await expect(gift(page, one)).toHaveCount(0);
  } finally {
    await page.goto("/lists");
    for (const name of [one, two]) {
      const remove = page.getByRole("button", { name: `Remove ${name} from your list` });
      if ((await remove.count()) === 0) continue;
      await remove.click();
      await page.getByRole("heading", { level: 1, name: "My list" }).click();
      await expect(page.getByText(`Removed ${name}`, { exact: true })).toHaveCount(0, { timeout: 15_000 });
    }
    await expect(saveStatus(page)).toHaveText("Saved");
    await page.reload();
    await expect(gift(page, one)).toHaveCount(0);
    await expect(gift(page, two)).toHaveCount(0);
  }
});
