import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { signIn } from "./sign-in";

// Adding a gift that needs a size you haven't saved asks for it, and saving
// there keeps every other saved size and switch as it was. A fresh account,
// so its sizes start empty.

async function addByHand(page: Page, name: string) {
  await page.getByRole("button", { name: "Add by hand" }).click();
  await page.getByLabel("Gift name").fill(name);
  await page.getByLabel("Price").fill("20");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  // My list saves as you go; leaving before it's saved would leave no list behind.
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");
}

const card = (page: Page) => page.getByRole("region", { name: /Add your .* size\?/ });

test("adding a shirt asks for the shirt size, and saving it leaves the hat as it was", async ({ page }) => {
  const owner = await createFreshUser("Sam");
  await signIn(page, owner);

  // Sizes sit in Settings once there's a list, so start one.
  await page.goto("/lists");
  await addByHand(page, "Kettle");
  // A hat size saved but not shared, to prove the card's save doesn't touch it.
  await page.goto("/settings/sizes");
  await page.getByLabel("Hat", { exact: true }).fill("7 1/4");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

  await page.goto("/lists");
  await addByHand(page, "Flannel Shirt");
  await expect(card(page)).toHaveAccessibleName("Add your shirt or top size?");
  await card(page).getByLabel("Shirt or top size").fill("M");
  await card(page).getByRole("button", { name: "Save and share" }).click();
  await expect(page.getByText("Saved and shared. Anyone with your list link will see your shirt or top size when they go to claim.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Change it in Settings" })).toHaveAttribute("href", "/settings/sizes");

  // The hat is saved, so a beanie doesn't ask.
  await addByHand(page, "Wool Beanie");
  await expect(card(page)).toHaveCount(0);

  await page.goto("/settings/sizes");
  await expect(page.getByLabel("Shirt or top", { exact: true })).toHaveValue("M");
  await expect(page.getByRole("switch", { name: "Share Shirt or top" })).toBeChecked();
  await expect(page.getByLabel("Hat", { exact: true })).toHaveValue("7 1/4");
  await expect(page.getByRole("switch", { name: "Share Hat" })).not.toBeChecked();
});

test("Not now hides it, and the same size isn't asked again", async ({ page }) => {
  const owner = await createFreshUser("Sam");
  await signIn(page, owner);
  await page.goto("/lists");
  await addByHand(page, "Running Sneakers");
  await card(page).getByRole("button", { name: "Not now" }).click();
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await addByHand(page, "Hiking Boots");
  await expect(card(page)).toHaveCount(0);
});
