import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { phoneLayoutProblems } from "./phone-layout";
import { signIn } from "./sign-in";

// My list saves as you go (ALL-127, design/ui.md > My list). The rules in
// detail are GiftApp's component tests; these check them against the real
// server and database.

async function addGiftByHand(page: Page, name: string) {
  await page.getByRole("button", { name: "Add by hand" }).click();
  await page.getByLabel("Gift name").fill(name);
  await page.getByLabel("Price").fill("12");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

const saveStatus = (page: Page) => page.getByRole("status", { name: "Save status" });
const gift = (page: Page, name: string) => page.getByRole("heading", { level: 3, name, exact: true });

test("adds save at once, Undo puts a gift back, and a remove saves once its window passes (AC-11, AC-12)", async ({ page }) => {
  await signIn(page, await createFreshUser());
  await page.goto("/lists");
  await addGiftByHand(page, "Kettle");
  await addGiftByHand(page, "Novel");
  await expect(saveStatus(page)).toHaveText("Saved");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Remove Kettle from your list" }).click();
  await expect(page.getByText("Removed Kettle", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(gift(page, "Kettle")).toBeVisible();

  await page.getByRole("button", { name: "Remove Kettle from your list" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeFocused();
  // The Undo window (6 s) waits while Undo has focus; move on, and it's sent.
  await page.getByRole("heading", { level: 1, name: "My list" }).click();
  await expect(page.getByText("Removed Kettle", { exact: true })).toHaveCount(0, { timeout: 10_000 });
  await expect(saveStatus(page)).toHaveText("Saved");

  await page.reload();
  await expect(gift(page, "Novel")).toBeVisible();
  await expect(gift(page, "Kettle")).toHaveCount(0);
});

test("a stale tab can't overwrite newer gifts, and keeps its own (AC-14)", async ({ page, context }) => {
  await signIn(page, await createFreshUser());
  await page.goto("/lists");
  await addGiftByHand(page, "Kettle");
  await expect(saveStatus(page)).toHaveText("Saved");

  const stale = await context.newPage();
  await stale.goto("/lists");
  await expect(gift(stale, "Kettle")).toBeVisible();

  await addGiftByHand(page, "Scarf");
  await expect(saveStatus(page)).toHaveText("Saved");

  await addGiftByHand(stale, "Mug");
  await expect(stale.getByText("Your list changed somewhere else. We've loaded the latest.")).toBeVisible();
  await expect(saveStatus(stale)).toHaveText("Saved");
  for (const name of ["Kettle", "Scarf", "Mug"]) await expect(gift(stale, name)).toBeVisible();

  await page.reload();
  for (const name of ["Kettle", "Scarf", "Mug"]) await expect(gift(page, name)).toBeVisible();
});

test.describe("a remove held for Undo is sent when the page goes (AC-17)", () => {
  async function holdARemove(page: Page) {
    await signIn(page, await createFreshUser());
    await page.goto("/lists");
    await addGiftByHand(page, "Kettle");
    await addGiftByHand(page, "Novel");
    await expect(saveStatus(page)).toHaveText("Saved");
    await page.getByRole("button", { name: "Remove Kettle from your list" }).click();
    await expect(page.getByText("Removed Kettle", { exact: true })).toBeVisible();
  }

  // The send can land just after the next page loads, so look again until it
  // has. Look from a second tab: reloading the first while its save is still
  // on the way would rightly ask before leaving.
  async function expectGone(page: Page) {
    const check = await page.context().newPage();
    await expect(async () => {
      await check.goto("/lists");
      await expect(gift(check, "Novel")).toBeVisible();
      await expect(gift(check, "Kettle")).toHaveCount(0);
    }).toPass({ timeout: 10_000 });
    await check.close();
  }

  test("left in the app, without asking", async ({ page }) => {
    await holdARemove(page);
    page.on("dialog", (dialog) => {
      throw new Error(`Asked before leaving: ${dialog.message()}`);
    });
    await page.getByRole("link", { name: "Give" }).click();
    await expect(page).toHaveURL(/\/give$/);
    await expectGone(page);
  });

  test("the tab unloads, through the close route", async ({ page }) => {
    await holdARemove(page);
    const closed = page.waitForResponse((res) => res.url().endsWith("/api/lists/save-on-close"));
    await page.goto("/settings");
    const res = await closed;
    // Saved by the route itself: a 200 with the version it saved.
    expect(res.status()).toBe(200);
    expect(res.request().postDataJSON()).toMatchObject({ removeIds: [expect.any(String)] });
    expect(await res.json()).toMatchObject({ version: expect.any(String), behind: false });
    await expectGone(page);
  });
});

test.describe("at 320 px, the narrowest phone", { tag: "@layout" }, () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the Undo bar fits and stays in view", async ({ page }) => {
    await signIn(page, await createFreshUser());
    await page.goto("/lists");
    await addGiftByHand(page, "Hand-thrown ceramic pour-over coffee set with two cups");
    await addGiftByHand(page, "Kettle");
    await page.getByRole("button", { name: /^Remove Hand-thrown/ }).click();
    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeInViewport({ ratio: 1 });
    await expect(page.getByText(/^Removed Hand-thrown.*cups$/)).toBeVisible();
    expect(await phoneLayoutProblems(page)).toEqual([]);
  });
});
