import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { phoneLayoutProblems } from "./phone-layout";
import { saveSneakerList } from "./seed";
import { signIn, type Credentials } from "./sign-in";

// Sizes saved in Settings, read by people claiming from the list, signed in or not.
// Fresh accounts: one row each.
const GIFT = "Allbirds Wool Runners Sneakers";

async function saveSizes(page: Page, owner: Credentials, { shareHat }: { shareHat: boolean }) {
  await signIn(page, owner);
  await page.goto("/settings");
  await page.getByRole("link", { name: /Sizes and favorites/ }).click();
  await expect(page).toHaveURL(/\/settings\/sizes$/);
  await page.getByLabel("Shoe", { exact: true }).fill("10.5");
  await page.getByLabel("Hat", { exact: true }).fill("7 1/4");
  await page.getByRole("switch", { name: "Share Shoe" }).click();
  if (shareHat) await page.getByRole("switch", { name: "Share Hat" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.context().clearCookies();
}

// Opens a box on the list as a signed-out visitor, after the sizes have been fetched.
async function openAsVisitor(page: Page, path: string, box: "view" | "claim") {
  const sizes = page.waitForResponse((r) => r.url().endsWith("/sizes") && r.request().method() === "GET");
  await page.goto(path);
  await expect(page.getByRole("heading", { name: GIFT })).toBeVisible();
  await sizes;
  if (box === "view") await page.getByRole("link", { name: /^View on/ }).click();
  else await page.getByRole("button", { name: `Claim ${GIFT}` }).click();
  return page.getByRole("dialog");
}

test("a signed-out visitor sees the shared shoe size, not the hat, before buying and when claiming", async ({ page, request }) => {
  const owner = await createFreshUser("Sam");
  const path = await saveSneakerList(owner);
  await saveSizes(page, owner, { shareHat: false });

  // Nothing is in the page itself (AC-9).
  const html = await (await request.get(path)).text();
  // A bare "10.5" turns up in the logo's SVG path, so look for it as a value.
  expect(html).not.toMatch(/"10\.5"|>10\.5<|Shoe: 10\.5/);
  expect(html).not.toMatch(/Sam.s sizes|Their sizes/);
  expect(html).not.toContain("7 1/4");

  const view = await openAsVisitor(page, path, "view");
  await expect(view.getByText("Going to buy it?")).toBeVisible();
  await expect(view.getByText("Shoe: 10.5")).toBeVisible();
  await expect(view).not.toContainText("Hat");
  await view.getByRole("button", { name: "Cancel" }).click();

  const claim = page.getByRole("button", { name: `Claim ${GIFT}` });
  await claim.click();
  await expect(page.getByRole("dialog").getByText("Shoe: 10.5")).toBeVisible();
  await expect(page.getByRole("dialog")).not.toContainText("Hat");
});

test("with Share turned off the visitor sees no panel", async ({ page }) => {
  const owner = await createFreshUser("Sam");
  const path = await saveSneakerList(owner);
  await saveSizes(page, owner, { shareHat: false });
  await signIn(page, owner);
  await page.goto("/settings/sizes");
  await page.getByRole("switch", { name: "Share Shoe" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.context().clearCookies();

  // openAsVisitor waits for the response, so an empty answer can't pass by being early.
  const view = await openAsVisitor(page, path, "view");
  await expect(view.getByText("Going to buy it?")).toBeVisible();
  await expect(view).not.toContainText("10.5");
  await expect(view).not.toContainText("sizes");
});

test("the Sizes screen fits the narrowest phone", { tag: "@layout" }, async ({ page }) => {
  const owner = await createFreshUser("Sam");
  await saveSneakerList(owner);
  await signIn(page, owner);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/settings/sizes");
  await expect(page.getByLabel("Shoe", { exact: true })).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
});

test("a box opened before the sizes arrive doesn't move when they do", { tag: "@layout" }, async ({ page }) => {
  const owner = await createFreshUser("Sam");
  const path = await saveSneakerList(owner);
  await saveSizes(page, owner, { shareHat: false });

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/sizes", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(path);
  await expect(page.getByRole("heading", { name: GIFT })).toBeVisible();
  await page.getByRole("button", { name: `Claim ${GIFT}` }).click();
  const dialog = page.getByRole("dialog");
  const button = dialog.getByRole("button", { name: "Claim gift" });
  await expect(button).toBeVisible();
  const before = (await button.boundingBox())!;

  const arrived = page.waitForResponse((r) => r.url().endsWith("/sizes"));
  release();
  await arrived;
  // Nothing in the page reacts to the response, so give React a beat to (not) re-render.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(dialog.getByText("Shoe: 10.5")).toHaveCount(0);
  expect(await button.boundingBox()).toEqual(before);
});
