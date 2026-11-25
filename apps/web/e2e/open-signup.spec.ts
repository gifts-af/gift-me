import { expect, test, type Page } from "@playwright/test";
import { createFreshUser, giveAccess } from "./fresh-user";
import { phoneLayoutProblems } from "./phone-layout";
import { rest, rpcAs } from "./rounds";
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
  ["/give", "People"],
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

test("without access, signing in and / land on My list, and Give shows the pitch (AC-3, AC-4)", async ({ page }) => {
  const user = await createFreshUser(undefined, { access: false });
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(user.email);
  // eslint-disable-next-line no-restricted-syntax -- this tests where the sign-in form takes you
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(page.getByRole("region", { name: "My list" })).toBeVisible();

  await page.getByRole("link", { name: "Give", exact: true }).click();
  await expect(page).toHaveURL(/\/give$/);
  await expect(pitch(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "People" })).toHaveCount(0);
  for (const path of ["/people/new", "/settings/paying"]) {
    await page.goto(path);
    await expect(pitch(page)).toBeVisible();
  }
});

test("without access, Back after / sent you to My list leaves it", async ({ page }) => {
  await signIn(page, await createFreshUser(undefined, { access: false }));
  const list = page.getByRole("region", { name: "My list" });

  // Opened by its address, as the home-screen app does.
  await page.goto("/settings");
  await page.goto("/");
  await expect(page).toHaveURL(/\/lists$/);
  await expect(list).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  // Inside the app, by the logo, and again from the list itself.
  const logo = page.getByRole("link", { name: "GiftsAF", exact: true });
  await logo.click();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(list).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await logo.click();
  await expect(list).toBeVisible();
  await logo.click();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(list).toBeVisible();
  // The press from the list added a second /lists, so Back shows the first.
  await page.goBack();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(list).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
});

test("with access, / and the logo land on Give, with your people (AC-9)", async ({ page }) => {
  await signIn(page, await createFreshUser());
  await page.goto("/settings");
  await page.goto("/");
  await expect(page).toHaveURL(/\/give$/);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Give", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("link", { name: "GiftsAF", exact: true }).click();
  await expect(page).toHaveURL(/\/give$/);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
});

test("signed out, /give goes to sign-in and back", async ({ page }) => {
  await page.goto("/give");
  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fgive$/);
  const user = await createFreshUser();
  await page.getByLabel("Email").fill(user.email);
  // eslint-disable-next-line no-restricted-syntax -- this tests where the sign-in form takes you
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/give$/);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
});

const account = async (userId: string) =>
  (
    await rest<{ concierge_access: boolean; access_requested_at: string | null }[]>(
      `accounts?user_id=eq.${userId}&select=concierge_access,access_requested_at`,
    )
  )[0];

test("one tap asks for access, and asking again changes nothing (AC-6)", async ({ page }) => {
  const user = await createFreshUser("Jordan", { access: false });
  const { id } = (await session(user)).user;
  await signIn(page, user);
  await page.goto("/give");
  await expect(pitch(page)).toBeVisible();
  // A second tab, still showing the button after the first one is used.
  const other = await page.context().newPage();
  await other.goto("/people/new");
  await expect(other.getByRole("button", { name: "Request access" })).toBeVisible();

  await page.getByRole("button", { name: "Request access" }).click();
  // No reload needed: the whole page becomes the sent one.
  await expect(page.getByRole("heading", { level: 1, name: "You asked for access" })).toBeVisible();
  await expect(page.getByText("Request sent", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request access" })).toHaveCount(0);
  const asked = await account(id);
  expect(asked.concierge_access).toBe(false);
  expect(Math.abs(Date.now() - Date.parse(asked.access_requested_at!))).toBeLessThan(60_000);

  await page.reload();
  await expect(page.getByText("Request sent", { exact: true })).toBeVisible();
  await other.getByRole("button", { name: "Request access" }).click();
  await expect(other.getByRole("heading", { level: 1, name: "You asked for access" })).toBeVisible();
  expect(await account(id)).toEqual(asked);
});

/** Saves a one-gift list. */
async function saveList(owner: Credentials): Promise<void> {
  await rpcAs(owner, "lists", "save_list_checked", {
    p_list_id: null,
    p_title: null,
    p_items: [{ id: null, name: "Wool socks", price_cents: 1500, image_url: null, product_url: null, asin: null, source: "manual", added_at: null }],
    p_expected: null,
  });
}

test("Settings without access shows your own settings and none of the concierge's (AC-7)", async ({ page }) => {
  const user = await createFreshUser("Jordan", { access: false });
  await signIn(page, user);
  await page.goto("/settings");
  const row = (name: RegExp) => page.getByRole("main").getByRole("link", { name });
  const groups = ["Reminders", "Gift ideas", "Paying for gifts"];
  await expect(row(/^Name/)).toBeVisible();
  await expect(page.getByLabel("Time zone")).toBeVisible();
  for (const name of groups) await expect(page.getByRole("heading", { name })).toHaveCount(0);
  expect(await (await page.request.get("/settings")).text()).not.toContain("/settings/paying");

  // With a list, My address shows here too.
  await saveList(user);
  await page.reload();
  await expect(row(/^My address/)).toBeVisible();
  for (const name of groups) await expect(page.getByRole("heading", { name })).toHaveCount(0);

  // Let in, the groups are there, so "not shown" above means something.
  await giveAccess((await session(user)).user.id);
  await page.reload();
  for (const name of groups) await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("once access is off, the test email refuses and sends nothing (AC-16)", async ({ page }) => {
  const user = await createFreshUser();
  const { id } = (await session(user)).user;
  await signIn(page, user);
  await page.goto("/settings/reminders");
  const send = page.getByRole("button", { name: "Send me a test email" });
  await expect(send).toBeVisible();
  await rest(`accounts?user_id=eq.${id}`, { method: "PATCH", body: { concierge_access: false } });
  await send.click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  expect(await rest(`notifications?user_id=eq.${id}`)).toEqual([]);
});
