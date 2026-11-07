import { expect, test } from "@playwright/test";

// ALL-74: everyone can switch light/dark, and the choice sticks on this device.
// The owner's wife's phone reported dark without her choosing it; she needs a
// way to light mode without changing her phone.
const isDark = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));

test.describe("a phone that reports dark", () => {
  test.use({ colorScheme: "dark" });

  // @layout: the only check that dark mode works on Android and desktop too (ALL-118).
  test("starts dark, switches to light, and stays light across pages and visits", { tag: "@layout" }, async ({ page }) => {
    await page.goto("/");
    expect(await isDark(page)).toBe(true);
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    expect(await isDark(page)).toBe(false);
    await page.reload();
    expect(await isDark(page)).toBe(false);
    await page.goto("/auth/login");
    expect(await isDark(page)).toBe(false);
    await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
  });
});

test.describe("a phone with no preference", () => {
  test.use({ colorScheme: "no-preference" });

  test("starts light", async ({ page }) => {
    await page.goto("/");
    expect(await isDark(page)).toBe(false);
    await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
  });
});
