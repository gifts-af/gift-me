import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";
import { TEST_USER } from "./test-user";

// ALL-20 acceptance: sign in, see the app shell, the session survives a
// refresh, sign out. Runs on both phones and desktop Chrome (ALL-60). Since ALL-46 a signed-out "/" is the home page,
// and sign-in starts from its Sign in link.
test("sign in, see Home, stay signed in, sign out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Gifting, handled AF." })).toBeVisible();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  await page.getByLabel("Email").fill(TEST_USER.email);
  // eslint-disable-next-line no-restricted-syntax -- this is the test of the login form itself
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Your own list first, even with concierge access, on a browser that's never chosen Give.
  await expect(page).toHaveURL(/\/lists$/);
  await expect(page.getByRole("region", { name: "My list" })).toBeVisible();
  await page.getByRole("link", { name: "Give", exact: true }).click();
  await expect(page).toHaveURL(/\/give$/);
  await expect(page.getByRole("link", { name: "GiftsAF" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^You/ })).toBeVisible();
  // Usable at any width, 375 px included: nothing wider than the screen.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth\/login/);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Gifting, handled AF." })).toBeVisible();
});

test("a deep link survives sign-in", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fsettings$/);
  await page.getByLabel("Email").fill(TEST_USER.email);
  // eslint-disable-next-line no-restricted-syntax -- this tests that a deep link survives signing in through the form
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

// Opening the site goes to My list, unless this browser last chose Give.
// "/" redirects from inside its loading state, so the browser navigates a second
// time and Playwright can report the first as interrupted. The URL checks after wait for the landing.
async function openSite(page: Page) {
  await page.goto("/").catch((error: Error) => {
    if (!error.message.includes("is interrupted by another navigation")) throw error;
  });
}

test("the site opens on the tab this browser last used, My list on a new one", async ({ browser }) => {
  const first = await browser.newContext();
  const page = await first.newPage();
  await signIn(page);
  await openSite(page);
  await expect(page).toHaveURL(/\/lists$/);

  await page.getByRole("link", { name: "Give", exact: true }).click();
  await expect(page).toHaveURL(/\/give$/);
  await openSite(page);
  await expect(page).toHaveURL(/\/give$/);

  await page.getByRole("link", { name: "Get", exact: true }).click();
  await expect(page).toHaveURL(/\/lists$/);
  await openSite(page);
  await expect(page).toHaveURL(/\/lists$/);

  // Back on Give, then a new browser for the same person: My list again.
  await page.goto("/give");
  await first.close();
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await signIn(other);
  await openSite(other);
  await expect(other).toHaveURL(/\/lists$/);
  await fresh.close();
});
