import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { signIn } from "./sign-in";

async function addGiftByHand(page: Page, name: string) {
  await page.getByRole("button", { name: "Add by hand" }).click();
  await page.getByLabel("Gift name").fill(name);
  await page.getByLabel("Price").fill("12");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

// ALL-136: someone with no display name is asked for one when they share their
// list, and can set it in Settings. The name is only ever what they type.
test("Share asks for a name, saves it, and Settings shows it", async ({ page }) => {
  const owner = await createFreshUser();
  await signIn(page, owner);
  await page.goto("/lists");
  await addGiftByHand(page, "Wool socks");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");
  // No clipboard here, so the link shows on the page instead (every browser).
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined }));

  await page.getByRole("button", { name: /Share/ }).click();
  const dialog = page.getByRole("dialog", { name: "What name should your list show?" });
  await expect(dialog.getByLabel("Your name")).toHaveValue("");
  await dialog.getByLabel("Your name").fill("Sam Tester");
  await dialog.getByRole("button", { name: "Save and copy link" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Share link")).toHaveValue(/\/share\//);

  await page.goto("/settings");
  const row = page.getByRole("link", { name: /^Name/ });
  await expect(row).toContainText("Sam Tester");
  await row.click();
  const field = page.getByRole("textbox", { name: "Your name" });
  await expect(field).toHaveValue("Sam Tester");
  await field.fill("Sam T.");
  await field.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Saved");

  // Named now: Share just shares.
  await page.goto("/lists");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined }));
  await page.getByRole("button", { name: /Share/ }).click();
  await expect(page.getByLabel("Share link")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
