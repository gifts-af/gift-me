import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { phoneLayoutProblems } from "./phone-layout";
import { rest } from "./rounds";
import { session, signIn, type Credentials } from "./sign-in";

// The concierge is by request: without access, its pages show the pitch and
// nothing of their own, whatever is in the account.

const NAME = "Zebulon";

/** A person in the account, as if access had been on before. */
async function seedPerson(user: Credentials): Promise<string> {
  const userId = (await session(user)).user.id;
  const [person] = await rest<{ id: string }[]>("people", {
    method: "POST",
    profile: "public",
    body: { user_id: userId, name: NAME, relationship: "friend" },
  });
  return person.id;
}

async function markRequested(user: Credentials) {
  await rest("accounts?on_conflict=user_id", {
    method: "POST",
    upsert: true,
    body: { user_id: (await session(user)).user.id, access_requested_at: new Date().toISOString() },
  });
}

// Each gated page, and its own title. With the list card on, a person's list
// screen sends you back to the person, so its title is theirs.
const pages = (id: string): [path: string, ownTitle: string][] => [
  ["/people/new", "Add someone you buy for"],
  ["/people/import", "Who do you buy gifts for?"],
  [`/people/${id}`, NAME],
  [`/people/${id}/about`, `About ${NAME}`],
  [`/people/${id}/address`, "Shipping address for"],
  [`/people/${id}/budget`, "Budget for"],
  [`/people/${id}/gifts`, "Past gifts for"],
  [`/people/${id}/ideas`, "Gift ideas for"],
  [`/people/${id}/list`, NAME],
  [`/people/${id}/questions`, "A few questions about"],
  [`/people/${id}/saved-gifts`, "Saved gifts for"],
  ["/settings/reminders", "Reminders"],
  ["/settings/over-budget", "Over-budget allowance"],
  ["/settings/paying", "Paying for gifts"],
];

const pitch = (page: Page) => page.getByRole("heading", { level: 1, name: "Gifting, handled AF." });

test("without access, every concierge page shows the pitch and none of its own content (AC-5)", async ({ page }) => {
  test.slow(); // Every page, twice.
  const user = await createFreshUser(undefined, { access: false });
  const id = await seedPerson(user);
  await signIn(page, user);

  for (const [path, ownTitle] of pages(id)) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(pitch(page)).toBeVisible();
      // In the page's frame, under the top bar.
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("main")).toContainText("Nothing is bought without your yes.");
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      // The whole response, as a page and as the data a link inside the app
      // fetches: the page's own content isn't hidden in either.
      for (const headers of [{}, { rsc: "1" }] as Record<string, string>[]) {
        const body = await (await page.request.get(path, { headers })).text();
        expect(body).toContain("Gifting, handled AF.");
        expect(body).not.toContain(NAME);
        expect(body).not.toContain(ownTitle);
      }
    });
  }

  await markRequested(user);
  await page.goto(`/people/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: "You asked for access" })).toBeVisible();
  await expect(page.getByText("Request sent", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Go to my list" })).toBeVisible();

  // Let in, the same account sees every page, so "not shown" above means something.
  await rest(`accounts?user_id=eq.${(await session(user)).user.id}`, { method: "PATCH", body: { concierge_access: true } });
  for (const [path, ownTitle] of pages(id)) {
    await test.step(`${path} with access`, async () => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(ownTitle);
    });
  }
});

test("the pitch fits the screen, before and after asking", { tag: "@layout" }, async ({ page }, testInfo) => {
  const user = await createFreshUser(undefined, { access: false });
  await signIn(page, user);
  await page.goto("/people/new");
  await expect(pitch(page)).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("pitch.png") });

  await markRequested(user);
  await page.reload();
  await expect(page.getByText("Request sent", { exact: true })).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("pitch-requested.png") });
});
