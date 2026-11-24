import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { MIN_TAP_PX, phoneLayoutProblems } from "./phone-layout";
import { rest, readyBuyer, seedPastGifts } from "./rounds";
import { signIn } from "./sign-in";

// How a gift went over: the page an email's answer opens, and the person's past gifts, against the
// local Supabase. Each test has its own fresh buyer.

const reactionsOf = (orderId: string) => rest<{ rating: string; note: string | null }[]>(`reactions?select=rating,note&order_id=eq.${orderId}`);

test("an email's answer opens chosen, saves only on Save, and shows in past gifts", async ({ page }) => {
  const b = await readyBuyer(await createFreshUser());
  const { personId, roundId, unanswered } = await seedPastGifts(b.id, "Nora");
  await signIn(page, b.creds);
  await page.goto(`/rounds/${roundId}/reaction?gift=${unanswered.orderId}&r=loved`);
  const card = page.getByRole("listitem", { name: unanswered.title });
  await expect(card.getByRole("radio", { name: "Loved it" })).toBeChecked();
  await expect(card.getByText("Not saved yet.")).toBeVisible();
  expect(await reactionsOf(unanswered.orderId)).toEqual([]);

  await card.getByRole("textbox", { name: /Note/ }).fill("Uses it daily");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Saved. Thanks, we'll use this for next time.")).toBeVisible();
  expect(await reactionsOf(unanswered.orderId)).toEqual([{ rating: "loved", note: "Uses it daily" }]);

  await page.getByRole("link", { name: "Back to Nora" }).click();
  await page.getByRole("link", { name: "Past gifts" }).click();
  await expect(page).toHaveURL(`/people/${personId}/gifts`);
  const item = page.getByRole("listitem").filter({ hasText: unanswered.title });
  await expect(item).toContainText("Loved it");
  await expect(item).toContainText("Uses it daily");
});

async function problemsInBothSchemes(page: Page, open: () => Promise<void>): Promise<string[]> {
  const problems: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open();
    problems.push(...(await phoneLayoutProblems(page)).map((p) => `${scheme}: ${p}`));
  }
  return problems;
}

test("the reaction page fits the screen, with answers two to a row on a phone", { tag: "@layout" }, async ({ page }, info) => {
  const b = await readyBuyer(await createFreshUser());
  const { roundId, unanswered } = await seedPastGifts(b.id, "Nora");
  await signIn(page, b.creds);
  const card = page.getByRole("listitem", { name: unanswered.title });
  const problems = await problemsInBothSchemes(page, async () => {
    await page.goto(`/rounds/${roundId}/reaction?gift=${unanswered.orderId}&r=loved`);
    await expect(card.getByRole("button", { name: "Save" })).toBeEnabled();
  });
  expect(problems).toEqual([]);
  // The link's gift is in view, though it isn't the first.
  await expect(card.getByRole("radio", { name: "Loved it" })).toBeInViewport();

  const boxes = await Promise.all((await card.locator("label:has(input[type=radio])").all()).map((l) => l.boundingBox()));
  expect(boxes).toHaveLength(4);
  for (const box of boxes) expect(box!.height).toBeGreaterThanOrEqual(MIN_TAP_PX);
  const perRow = info.project.name === "desktop" ? 4 : 2;
  expect(boxes.filter((box) => Math.abs(box!.y - boxes[0]!.y) < 1)).toHaveLength(perRow);
});

test("past gifts fit the screen", { tag: "@layout" }, async ({ page }) => {
  const b = await readyBuyer(await createFreshUser());
  const { personId, unanswered } = await seedPastGifts(b.id, "Nora");
  await signIn(page, b.creds);
  const problems = await problemsInBothSchemes(page, async () => {
    await page.goto(`/people/${personId}/gifts`);
    await expect(page.getByRole("link", { name: `How did it go? ${unanswered.title}` })).toBeVisible();
    await expect(page.getByText("No gift was bought.")).toBeVisible();
  });
  expect(problems).toEqual([]);
});
