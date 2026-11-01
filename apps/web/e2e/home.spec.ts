import { expect, test } from "@playwright/test";
import { TEST_USER } from "./test-user";

// ALL-46: the public home page and the guided tour.
test("a signed-out visitor sees the home page at / on a phone", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Gifting, handled AF." })).toBeVisible();
  await expect(page.getByText(/Lots is broken/)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("on a computer the hook sits beside the pick-a-gift card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const text = await page.getByTestId("hook-text").boundingBox();
  const preview = await page.getByTestId("pick-preview").boundingBox();
  expect(text && preview).toBeTruthy();
  // Side by side: the card starts to the right of the text, and they overlap vertically.
  expect(preview!.x).toBeGreaterThan(text!.x + text!.width - 1);
  expect(preview!.y).toBeLessThan(text!.y + text!.height);
});

for (const colorScheme of ["dark", "light"] as const) {
  test(`the home page follows a ${colorScheme} browser`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme, viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Gifting, handled AF." })).toBeVisible();
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(isDark).toBe(colorScheme === "dark");
    await context.close();
  });
}

test("take the tour, then sign in with an invite", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Take the tour" }).click();
  await expect(page).toHaveURL(/\/tour$/);
  for (let i = 0; i < 6; i++) {
    // exact: under `pnpm dev` the Next.js dev tools button also matches "Next".
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await expect(page.getByText("Step 7 of 7")).toBeVisible();
  await page.getByRole("link", { name: "Have an invite? Sign in" }).click();
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
});

test("request access opens over the page and checks its fields (ALL-47, ALL-53)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Request access" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Want in?" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await dialog.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByText("Tell us your name.")).toBeVisible();
  await expect(page.getByText("Enter an email address like you@example.com.")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("feedback opens a box over the page, and Esc closes it (ALL-53)", async ({ page }) => {
  await page.goto("/");
  const open = page.getByRole("button", { name: "Send feedback" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Tell us the sad story" });
  await expect(dialog.getByLabel("What happened?")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

// ALL-54: the logo stays exactly where it is on the home page.
for (const width of [390, 1280]) {
  test(`the logo stays put across pages at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const logo = page.getByRole("img", { name: "GiftsAF" }).first();
    const spot = async (path: string) => {
      await page.goto(path);
      const box = await logo.boundingBox();
      return box && { x: Math.round(box.x), y: Math.round(box.y) };
    };
    const home = await spot("/");
    expect(await spot("/tour")).toEqual(home);
    expect(await spot("/request-access")).toEqual(home);

    await page.goto("/auth/login");
    await page.getByLabel("Email").fill(TEST_USER.email);
    await page.getByLabel("Password").fill(TEST_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
    expect(await spot("/")).toEqual(home);

    // The list, once loaded: on a phone "‹ Home" takes the logo's place, by
    // design (mock-up "list"); from 640 px the logo is back in its spot.
    await page.goto("/lists");
    await expect(page.getByRole("region", { name: "My list" })).toBeVisible();
    if (width < 640) {
      await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
    } else {
      expect(await spot("/lists")).toEqual(home);
    }
  });
}
