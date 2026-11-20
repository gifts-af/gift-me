import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { addMother } from "./seed";
import { signIn } from "./sign-in";

// The "‹ Mom" link at the top of a detail screen goes back to where you were
// on the page you came from, not to its top (ALL-131). A short screen, so the
// rows we open are below the fold.
test.use({ viewport: { width: 375, height: 480 } });

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

// Scrolls the row into view, opens it, comes back by the back link, and
// expects the page where it was left.
async function openAndComeBack(page: Page, row: RegExp, detailUrl: RegExp, back: string) {
  const link = page.getByRole("link", { name: row });
  await link.scrollIntoViewIfNeeded();
  const before = await scrollY(page);
  expect(before).toBeGreaterThan(0);
  await link.click();
  await expect(page).toHaveURL(detailUrl);
  await page.getByRole("link", { name: back, exact: true }).click();
  await expect(link).toBeVisible();
  await expect.poll(() => scrollY(page)).toBeGreaterThanOrEqual(before - 2);
  // Focus goes back to the row you tapped, as the browser's own Back does.
  await expect(link).toBeFocused();
}

test("back from a person's detail keeps your place on their page (ALL-131)", async ({ page }) => {
  const user = await createFreshUser();
  const personId = await addMother(user, "Mom");
  await signIn(page, user);
  await page.goto(`/people/${personId}`);
  await openAndComeBack(page, /^Shipping address/, new RegExp(`/people/${personId}/address$`), "Mom");
  // And again, so a second trip down and back works too.
  await openAndComeBack(page, /^Saved gifts/, new RegExp(`/people/${personId}/saved-gifts$`), "Mom");
});

test("going back shows what you just changed (ALL-131)", async ({ page }) => {
  const user = await createFreshUser();
  const personId = await addMother(user, "Mom");
  await signIn(page, user);
  await page.goto(`/people/${personId}`);
  await page.getByRole("link", { name: /^About Mom/ }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}/about$`));
  const name = page.getByRole("textbox", { name: "Name" });
  await expect(name).toBeEnabled();
  await name.fill("Mum");
  await name.press("Tab");
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: /^(Mom|Mum)$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Mum" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^About Mum/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^About Mum/ })).toBeFocused();
});

test("on a slow connection, it waits for the page before putting you back (ALL-131)", async ({ page }) => {
  const user = await createFreshUser();
  const personId = await addMother(user, "Mom");
  await signIn(page, user);
  await page.goto(`/people/${personId}`);
  const row = page.getByRole("link", { name: /^Budget/ });
  await row.scrollIntoViewIfNeeded();
  const before = await scrollY(page);
  expect(before).toBeGreaterThan(0);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}/budget$`));
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  // From here, every page the app fetches takes 1.5 s longer.
  await page.route("**/*", async (route) => {
    if (route.request().headers()["rsc"]) await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.getByRole("textbox", { name: "Any occasion" }).fill("60");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}$`));
  await expect(row).toContainText("$60");
  await expect.poll(() => scrollY(page)).toBeGreaterThanOrEqual(before - 2);
  await expect(row).toBeFocused();
});

test("saving a budget comes back to your place, showing the new budget (ALL-131)", async ({ page }) => {
  const user = await createFreshUser();
  const personId = await addMother(user, "Mom");
  await signIn(page, user);
  await page.goto(`/people/${personId}`);
  const row = page.getByRole("link", { name: /^Budget/ });
  await row.scrollIntoViewIfNeeded();
  const before = await scrollY(page);
  expect(before).toBeGreaterThan(0);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}/budget$`));
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "Any occasion" }).fill("75");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}$`));
  await expect(row).toContainText("$75");
  await expect.poll(() => scrollY(page)).toBeGreaterThanOrEqual(before - 2);
});

test("back from a Settings row keeps your place in Settings (ALL-131)", async ({ page }) => {
  await signIn(page, await createFreshUser());
  await page.goto("/settings");
  await openAndComeBack(page, /^Zinc/, /\/settings\/paying$/, "Settings");
});

test("opened straight from a link, back still opens the person's page (ALL-131)", async ({ page }) => {
  const user = await createFreshUser();
  const personId = await addMother(user, "Mom");
  await signIn(page, user);
  await page.goto(`/people/${personId}/address`);
  await page.getByRole("link", { name: "Mom", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}$`));
  await expect(page.getByRole("link", { name: /^Shipping address/ })).toBeAttached();
});
