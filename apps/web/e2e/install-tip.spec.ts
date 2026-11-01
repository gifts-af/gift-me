import { expect, test, type Browser } from "@playwright/test";
import { TEST_USER } from "./test-user";

// ALL-57: the "Add GiftsAF to your Home Screen" tip on the signed-in home page.
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const TIP = { name: "Add GiftsAF to your Home Screen" };

async function signedInHome(browser: Browser, options: { userAgent?: string; installed?: boolean } = {}) {
  const context = await browser.newContext({
    userAgent: options.userAgent,
    viewport: { width: 375, height: 812 },
    hasTouch: true,
  });
  if (options.installed) {
    // What an iPhone reports when GiftsAF is opened from its Home Screen icon.
    await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  }
  const page = await context.newPage();
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  return { context, page };
}

test("an iPhone browser shows the Share steps, and Not now hides them after a reload", async ({ browser }) => {
  const { context, page } = await signedInHome(browser, { userAgent: IPHONE });
  await expect(page.getByRole("heading", TIP)).toBeVisible();
  await expect(page.getByText("Add to Home Screen", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("heading", TIP)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(page.getByRole("heading", TIP)).toHaveCount(0);
  await context.close();
});

test("opened from the iPhone Home Screen, there's no tip", async ({ browser }) => {
  const { context, page } = await signedInHome(browser, { userAgent: IPHONE, installed: true });
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", TIP)).toHaveCount(0);
  await context.close();
});
