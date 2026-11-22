import { expect, test, type Page } from "@playwright/test";

// ALL-142, ALL-136 and ALL-123 on giftsaf.com, as the QA account. Run with
// `pnpm live-check e2e-live/all-142-136-lists-and-name.spec.ts`.
// It adds one gift and removes it again (afterEach, so a failed run still
// cleans up), and never saves a name: Skip only writes to this browser.
const NAME = `Live check ALL-142 ${Date.now()}`;

async function removeLeftover(page: Page, name: string = NAME) {
  await page.goto("/lists");
  const card = page.locator("article").filter({ hasText: name });
  if ((await card.count()) === 0) return;
  await card.getByRole("button", { name: /remove/i }).click();
  // The Undo window waits while Undo is hovered or focused (T74): move both away.
  await page.mouse.move(0, 0);
  await page.getByRole("heading", { level: 1, name: "My list" }).click();
  await page.waitForTimeout(9_000); // past the Undo window
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved", { timeout: 20_000 });
}

test.afterEach(async ({ page }) => removeLeftover(page));

test("ALL-142: My list saves, and an http photo is stored as https", async ({ page }) => {
  await page.goto("/lists");
  await page.getByRole("button", { name: "Add by hand" }).click();
  await page.getByLabel("Gift name").fill(NAME);
  await page.getByLabel("Price").fill("1");
  await page.getByLabel(/Image URL/).fill("http://m.media-amazon.com/images/I/51jwXyqEB3L.jpg");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved", { timeout: 15_000 });

  // After a reload the gift comes from the database, its photo moved to https.
  await page.reload();
  const card = page.locator("article").filter({ hasText: NAME });
  await expect(card.locator("img")).toHaveAttribute("src", "https://m.media-amazon.com/images/I/51jwXyqEB3L.jpg");
  await card.screenshot({ path: test.info().outputPath("saved-gift.png") });

  await removeLeftover(page);
  await page.reload();
  await expect(page.locator("article").filter({ hasText: NAME })).toHaveCount(0);
});

test("ALL-136: Settings shows the name, and Share asks only when there's none", async ({ page }) => {
  await page.goto("/settings");
  const row = page.getByRole("link", { name: /^Name/ });
  await expect(row).toBeVisible();
  const hasName = !(await row.textContent())?.includes("Not set");
  await page.screenshot({ path: test.info().outputPath("settings.png") });

  await page.goto("/lists");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined }));
  await page.getByRole("button", { name: /Share/ }).click();
  if (hasName) {
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } else {
    const dialog = page.getByRole("dialog", { name: "What name should your list show?" });
    await expect(dialog.getByLabel("Your name")).toHaveValue("");
    await page.screenshot({ path: test.info().outputPath("prompt.png") });
    await dialog.getByRole("button", { name: "Skip" }).click();
  }
  await expect(page.getByLabel("Share link")).toHaveValue(/\/share\//);

  // ALL-123: the owner opening their own link sees their list, with no add card.
  const shareUrl = await page.getByLabel("Share link").inputValue();
  await page.goto(new URL(shareUrl).pathname);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "This list and your people" })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("own-share.png") });
});
