import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { phoneLayoutProblems } from "./phone-layout";
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

test("Sign out with unsaved changes asks first, and staying keeps the gift and the session", async ({ page }) => {
  await signIn(page, await createFreshUser());
  await page.goto("/lists");
  await addGiftByHand(page, "Unsaved socks");
  let asked = "";
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    return dialog.dismiss();
  });
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect.poll(() => asked).toMatch(/unsaved/i);
  await expect(page).toHaveURL(/\/lists$/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Unsaved socks" })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
});

test.describe("which bar each page gets", () => {
  for (const [path, current] of [
    ["/", "Give"],
    ["/lists", "Get"],
    ["/people/new", "Give"],
    ["/people/import", "Give"],
    ["/settings", null],
    ["/extension/connect", null],
  ] as const) {
    test(`${path} has the tabs and account menu`, async ({ page }) => {
      await signIn(page);
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Switch to/ })).toHaveCount(0);
      for (const name of ["Get", "Give"]) {
        const tab = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true });
        await expect(tab).toBeVisible();
        if (name === current) await expect(tab).toHaveAttribute("aria-current", "page");
        else await expect(tab).not.toHaveAttribute("aria-current");
      }
    });
  }

  test("a shared list has no tabs or account menu, signed out or in", async ({ page }) => {
    const owner = await createFreshUser();
    await signIn(page, owner);
    await page.goto("/lists");
    await addGiftByHand(page, "Wool socks");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    // With no clipboard the app shows the link, on every browser.
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined }));
    await page.getByRole("button", { name: /Share/ }).click();
    const url = await page.getByLabel("Share link").inputValue();
    const path = new URL(url).pathname;

    const expectPlainBar = async () => {
      await expect(page.getByRole("heading", { name: "Wool socks" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Switch to/ })).toBeVisible();
      await expect(page.getByRole("link", { name: "Get", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Account" })).toHaveCount(0);
    };
    await page.goto(path);
    await expectPlainBar();
    await page.context().clearCookies();
    await page.goto(path);
    await expectPlainBar();
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

test.describe("at 320 px, the narrowest phone", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  // No people on purpose: PersonCard's name link is short by itself (its tap
  // area is a ::after), which phoneLayoutProblems flags, and that's not the bar.
  test("every signed-in page fits", async ({ page }) => {
    await signIn(page, await createFreshUser());
    await expect(page.getByRole("link", { name: /^You/ })).toBeVisible();
    expect(await phoneLayoutProblems(page)).toEqual([]);
    for (const path of ["/lists", "/settings"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
      expect(await phoneLayoutProblems(page)).toEqual([]);
    }
  });

  test("the tabs and account menu fit their slot on a phone", async ({ page }, info) => {
    // Phones only: 320 px is a phone's width, and a desktop browser also reserves
    // space for a scrollbar. "Every signed-in page fits" still covers it for scrolling.
    test.skip(info.project.name === "desktop");
    await signIn(page, await createFreshUser());
    await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
    const slot = page.locator("[data-top-bar-row] > div");
    expect(await slot.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test("the tabs are big enough to press", async ({ page }) => {
    await signIn(page, await createFreshUser());
    for (const name of ["Get", "Give"]) {
      const box = await page.getByRole("link", { name }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(68);
    }
  });

  test("a very long name in the back link stays on screen", async ({ page }) => {
    await signIn(page, await createFreshUser());
    const name = "Bartholomew".repeat(5);
    await page.getByRole("link", { name: "Add someone you buy for" }).first().click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Who are they to you?").selectOption({ label: "Mother" });
    await page.getByRole("button", { name: `Add ${name}` }).click();
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(/\/people\/.+/);
    await page.goto(`${page.url()}/questions`);
    const back = page.getByRole("main").getByRole("link", { name, exact: true });
    await expect(back).toBeVisible();
    const box = await back.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(await back.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test("a person's page and their questions fit, with the back link in the page", async ({ page }) => {
    await signIn(page, await createFreshUser());
    await page.getByRole("link", { name: "Add someone you buy for" }).first().click();
    await page.getByLabel("Name").fill("Ada");
    await page.getByLabel("Who are they to you?").selectOption({ label: "Mother" });
    await page.getByRole("button", { name: "Add Ada" }).click();
    await page.getByRole("link", { name: "Ada", exact: true }).click();
    await expect(page.getByRole("link", { name: "People" })).toBeVisible();
    await expect(page).toHaveURL(/\/people\/.+/);
    // A full load: pages kept hidden after moving around would count as 0 px tall.
    await page.reload();
    await expect(page.getByRole("link", { name: "Give" })).toHaveAttribute("aria-current", "page");
    expect(await phoneLayoutProblems(page)).toEqual([]);
    await page.goto(`${page.url()}/questions`);
    await expect(page.getByRole("link", { name: "Ada" })).toBeVisible();
    expect(await phoneLayoutProblems(page)).toEqual([]);
  });
});

