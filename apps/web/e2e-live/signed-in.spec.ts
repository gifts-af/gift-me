import { expect, test } from "@playwright/test";

// Run with `pnpm live-check`: a read-only look at giftsaf.com, signed in as the
// shared test account (design/operations.md > Production test account, T60).
for (const [path, current] of [
  ["/", "Give"],
  ["/lists", "Get"],
  ["/settings", null],
] as const) {
  test(`${path} shows the signed-in bar`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Get", "Give"]) {
      const tab = nav.getByRole("link", { name, exact: true });
      await expect(tab).toBeVisible();
      if (name === current) await expect(tab).toHaveAttribute("aria-current", "page");
      else await expect(tab).not.toHaveAttribute("aria-current");
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("it's the test account, not a real person's", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("menu")).toContainText("allensforever711+qa@gmail.com");
});
