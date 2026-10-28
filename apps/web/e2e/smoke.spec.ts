import { expect, test } from "@playwright/test";
import { TEST_USER } from "./test-user";

// ALL-20 acceptance: sign in, see the app shell at phone width, the session
// survives a refresh, sign out.
test("sign in, see Home on a phone, stay signed in, sign out", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "GiftMe" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(page.getByRole("link", { name: /My list|Start your wish list/ })).toBeVisible();
  // Usable at 375 px: nothing wider than the screen.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth\/login/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/login$/);
});

test("a deep link survives sign-in", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fsettings$/);
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
