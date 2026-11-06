import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { TEST_USER } from "./test-user";

// ALL-95: one bar with Get and Give on every signed-in page.
async function signIn(page: Page, user: { email: string; password: string } = TEST_USER) {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
}

async function addGiftByHand(page: Page, name: string) {
  await page.getByRole("button", { name: "Add by hand" }).click();
  await page.getByLabel("Gift name").fill(name);
  await page.getByLabel("Price").fill("12");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

const barAndLogo = async (page: Page) => {
  const bar = await page.locator("header:visible").boundingBox();
  const logo = await page.getByRole("img", { name: "GiftsAF" }).boundingBox();
  return { barY: bar?.y, barHeight: bar?.height, logoX: logo?.x, logoY: logo?.y };
};

test.describe("My list", () => {
  test("a signed-out visitor gets the sun/moon, with no tabs or account menu", async ({ page }) => {
    await page.goto("/lists");
    await expect(page.getByRole("button", { name: /Switch to/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Account" })).toHaveCount(0);
  });

  test("the bar is the same size and the logo in the same spot, signed out or in", async ({ page }) => {
    await page.goto("/lists");
    await expect(page.getByRole("button", { name: /Switch to/ })).toBeVisible();
    const signedOut = await barAndLogo(page);
    await signIn(page);
    await page.goto("/lists");
    await expect(page.getByRole("link", { name: "Get" })).toHaveAttribute("aria-current", "page");
    expect(await barAndLogo(page)).toEqual(signedOut);
  });

  test("the account menu is there, with Settings and Sign out", async ({ page }) => {
    await signIn(page);
    await page.goto("/lists");
    await page.getByRole("button", { name: "Account" }).click();
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  });

  test("pressing Give with unsaved changes still asks first", async ({ page }) => {
    await signIn(page, await createFreshUser());
    await page.goto("/lists");
    await addGiftByHand(page, "Unsaved socks");
    let asked = "";
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      return dialog.dismiss();
    });
    await page.getByRole("link", { name: "Give" }).click();
    await expect.poll(() => asked).toMatch(/unsaved/i);
    await expect(page).toHaveURL(/\/lists$/);
  });
});

test.describe("the You card on Give", () => {
  test("comes first and invites someone with no people and no list", async ({ page }) => {
    await signIn(page, await createFreshUser());
    const you = page.getByRole("link", { name: /^You/ });
    await expect(you).toContainText("Start your wish list");
    await expect(you).toHaveAttribute("href", "/lists");
    const card = await you.boundingBox();
    const add = await page.getByRole("link", { name: "Add someone you buy for" }).boundingBox();
    expect(card!.y).toBeLessThan(add!.y);
    await expect(page.getByRole("link", { name: /^My list/ })).toHaveCount(0);
  });

  test("shows the new count after saving and pressing Give", async ({ page }) => {
    await signIn(page, await createFreshUser());
    await page.getByRole("link", { name: "Get" }).click();
    await addGiftByHand(page, "Wool socks");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    await page.getByRole("link", { name: "Give" }).click();
    await expect(page.getByRole("link", { name: /^You/ })).toContainText("1 gift on your list");
  });
});
