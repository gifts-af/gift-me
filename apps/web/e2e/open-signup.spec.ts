import { expect, test, type Page } from "@playwright/test";
import { createFreshUser, giveAccess } from "./fresh-user";
import { phoneLayoutProblems } from "./phone-layout";
import { personFor, rest, rpcAs } from "./rounds";
import { session, signIn, type Credentials } from "./sign-in";

// People are free. The concierge is by request: without access, its pages show
// the pitch and nothing of their own, whatever is in the account.

const NAME = "Zebulon";

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

// Each gated page, and its own title.
const gated = (id: string): [path: string, ownTitle: string][] => [
  [`/people/${id}/ideas`, "Gift ideas for"],
  ["/settings/reminders", "Reminders"],
  ["/settings/over-budget", "Over-budget allowance"],
  ["/settings/paying", "Paying for gifts"],
];

// The people pages anyone signed in can use. With the list card on, a person's
// list screen sends you back to the person, so its title is theirs.
const open = (id: string, name: string): [path: string, title: string][] => [
  ["/people/new", "Add someone you buy for"],
  ["/people/import", "Who do you buy gifts for?"],
  [`/people/${id}`, name],
  [`/people/${id}/about`, `About ${name}`],
  [`/people/${id}/address`, "Shipping address for"],
  [`/people/${id}/budget`, "Budget for"],
  [`/people/${id}/gifts`, "Past gifts for"],
  [`/people/${id}/list`, name],
  [`/people/${id}/questions`, "A few questions about"],
  [`/people/${id}/saved-gifts`, "Saved gifts for"],
];

const pitch = (page: Page) => page.getByRole("heading", { level: 1, name: "Gifting, handled AF." });
const card = (page: Page) => page.getByRole("region", { name: "Want gifts found and shipped for you?" });

test("without access, the concierge's pages show the pitch and none of their own content (AC-5)", async ({ page }) => {
  const user = await createFreshUser(undefined, { access: false });
  const id = await seedPerson(user);
  const theirs = await seedPerson(await createFreshUser());
  await signIn(page, user);

  // Someone else's person looks the same as your own: nothing is read.
  for (const [path, ownTitle] of [...gated(id), ...gated(theirs).slice(0, 1)]) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(pitch(page)).toBeVisible();
      // In the page's frame, under the top bar.
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("main")).toContainText("Nothing is bought without your yes.");
      await expect(page.getByRole("button", { name: "Request access" })).toBeVisible();
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      if (path.endsWith("/ideas")) {
        await expect(page.getByRole("link", { name: "Back", exact: true })).toHaveAttribute("href", path.replace("/ideas", ""));
      }
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
  await page.goto(`/people/${id}/ideas`);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${id}$`));
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();

  await markRequested(user);
  await page.goto(`/people/${id}/ideas`);
  await expect(page.getByRole("heading", { level: 1, name: "You asked for access" })).toBeVisible();
  await expect(page.getByText("Request sent", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Go to my list" })).toBeVisible();

  // Let in, the same account sees every page, so "not shown" above means something.
  await giveAccess((await session(user)).user.id);
  for (const [path, ownTitle] of gated(id)) {
    await test.step(`${path} with access`, async () => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(ownTitle);
    });
  }
  await page.goto(`/people/${id}/ideas`);
  await expect(page.getByRole("main").getByRole("link", { name: NAME })).toHaveAttribute("href", `/people/${id}`);
  await expect(page.getByRole("link", { name: "Back", exact: true })).toHaveCount(0);
});

test("without access, you can add people, from scratch or a shared list, and use their pages (AC-4, AC-5, AC-19)", async ({ page }) => {
  test.slow(); // Every people page.
  await signIn(page, await createFreshUser(undefined, { access: false }));
  await page.goto("/people/new");
  await expect(page.getByRole("button", { name: "Add someone" })).toBeEnabled();
  await page.getByLabel("Name").fill(NAME);
  await page.getByLabel("Who are they to you?").selectOption({ label: "Friend" });
  await page.getByRole("button", { name: `Add ${NAME}` }).click();
  await expect(page).toHaveURL(/\/give$/);
  const person = page.getByRole("link", { name: NAME, exact: true });
  await expect(person).toBeVisible();
  await expect(page.getByText("No list linked")).toBeVisible();
  const id = (await person.getAttribute("href"))!.split("/").pop()!;

  for (const [path, title] of open(id, NAME)) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
      await expect(pitch(page)).toHaveCount(0);
    });
  }

  // What only the concierge does isn't on their page. The rest is.
  await page.goto(`/people/${id}`);
  await expect(page.getByRole("link", { name: /^Saved gifts/ })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Christmas" })).toBeVisible();
  const concierge = [
    page.getByRole("link", { name: /^Gift ideas/ }),
    page.getByRole("region", { name: "How ready their ideas are" }),
    page.getByText(/^(Order by|Too late to ship)/),
    page.getByRole("main").getByText(/waiting on an address/),
  ];
  for (const part of concierge) await expect(part).toHaveCount(0);
  await expect(page.getByText("Reminders come with the concierge.")).toBeVisible();

  // Someone's list, from the link they shared.
  const owner = await createFreshUser("Odalys");
  await saveList(owner);
  const [list] = await rest<{ share_token: string }[]>(`lists?select=share_token&owner_id=eq.${(await session(owner)).user.id}`, { profile: "lists" });
  await page.goto(`/share/${list.share_token}`);
  await page.getByRole("link", { name: "Add Odalys to your people" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Odalys");
  await expect(page.getByRole("main").getByText(/waiting on an address/)).toHaveCount(0);
  await page.getByLabel("Who are they to you?").selectOption({ label: "Mother" });
  await page.getByRole("button", { name: "Add Odalys" }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: /^Their list/ })).toContainText("Linked");
  await page.goto("/give");
  await expect(page.getByRole("link", { name: "Odalys", exact: true })).toBeVisible();
  await expect(page.getByText("Their own list", { exact: true })).toBeVisible();
});

test("with access, a person's page has the concierge's parts (AC-9)", async ({ page }) => {
  const user = await createFreshUser();
  const { personId } = await personFor((await session(user)).user.id, NAME);
  await signIn(page, user);
  await page.goto(`/people/${personId}`);
  await expect(page.getByRole("link", { name: /^Gift ideas/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "How ready their ideas are" })).toBeVisible();
  await expect(page.getByText(/^Order by/)).toBeVisible();
  await expect(page.getByRole("main").getByText(/waiting on an address/)).toBeVisible();
  await expect(page.getByText("Reminders come with the concierge.")).toHaveCount(0);
});

test("the pitch and the request card fit the screen, before and after asking", { tag: "@layout" }, async ({ page }, testInfo) => {
  const user = await createFreshUser(undefined, { access: false });
  const ideas = `/people/${await seedPerson(user)}/ideas`;
  await signIn(page, user);
  await page.goto(ideas);
  await expect(pitch(page)).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("pitch.png") });
  await page.goto("/give");
  await expect(card(page)).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("card.png"), fullPage: true });

  await markRequested(user);
  await page.goto(ideas);
  await expect(page.getByText("Request sent", { exact: true })).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("pitch-requested.png") });
  await page.goto("/give");
  await expect(page.getByText("You asked for access. We'll email you when you're in.")).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("card-requested.png"), fullPage: true });
});

test("without access, signing in and / land on My list, and Give shows People and the request card (AC-3, AC-4)", async ({ page }) => {
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
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(page.getByText("Add the people you buy for, and keep their lists in one place.")).toBeVisible();
  await expect(card(page)).toContainText("Gift ideas, reminders and buying come with the concierge.");
  await expect(pitch(page)).toHaveCount(0);
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
  // Once the page has finished, so the card has had its chance.
  expect(await (await page.request.get("/give")).text()).not.toContain("Want gifts found and shipped for you?");
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
  await expect(card(page)).toBeVisible();
  // A second tab, still showing the button after the first one is used.
  const other = await page.context().newPage();
  await other.goto("/settings/paying");
  await expect(other.getByRole("button", { name: "Request access" })).toBeVisible();

  await page.getByRole("button", { name: "Request access" }).click();
  // No reload needed, and a screen reader is told.
  const sent = page.getByRole("status").filter({ hasText: "You asked for access. We'll email you when you're in." });
  await expect(sent).toBeVisible();
  await expect(sent).toBeFocused();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request access" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  // Back on Give it still says so, and focus isn't taken again.
  await page.getByRole("link", { name: "Get", exact: true }).click();
  await expect(page.getByRole("region", { name: "My list" })).toBeVisible();
  await page.getByRole("link", { name: "Give", exact: true }).click();
  await expect(sent).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(sent).not.toBeFocused();
  const asked = await account(id);
  expect(asked.concierge_access).toBe(false);
  expect(Math.abs(Date.now() - Date.parse(asked.access_requested_at!))).toBeLessThan(60_000);

  await page.reload();
  await expect(sent).toBeVisible();
  await other.getByRole("button", { name: "Request access" }).click();
  await expect(other.getByRole("heading", { level: 1, name: "You asked for access" })).toBeVisible();
  await expect(other.getByText("Request sent", { exact: true })).toBeVisible();
  await expect(other.getByRole("status").filter({ hasText: "Request sent" })).toBeFocused();
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText("part of the concierge");
  expect(await rest(`notifications?user_id=eq.${id}`)).toEqual([]);
});
