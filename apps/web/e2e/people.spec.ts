import { expect, test } from "@playwright/test";
import { localSupabase } from "./local-supabase";
import { SECOND_USER, TEST_USER } from "./test-user";
import { createFreshUser } from "./fresh-user";
import { phoneLayoutProblems } from "./phone-layout";
import { addMother, addSavedGift, saveBudgets } from "./seed";
import { personFor, readyBuyer, rest, seedFailedOrder, seedRound } from "./rounds";
import { session, signIn } from "./sign-in";

// ALL-21: add someone, see their card, switch occasions and budgets, link their
// list, delete them. On a phone, as TEST_USER, against the local Supabase.
// The test users persist between runs, so the spec cleans up its own leftovers
// first and never assumes an empty Home.
test.use({ viewport: { width: 375, height: 812 } });

const supabase = localSupabase();

async function signInApi(user: { email: string; password: string }): Promise<{ token: string; id: string }> {
  const { access_token, user: { id } } = await session(user);
  return { token: access_token, id };
}

// Removes any person with this name a failed earlier run left behind (service role, so no RLS).
async function deleteLeftovers(name: string) {
  const { id } = await signInApi(TEST_USER);
  const res = await fetch(`${supabase.url}/rest/v1/people?user_id=eq.${id}&name=eq.${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { apikey: supabase.serviceRoleKey, Authorization: `Bearer ${supabase.serviceRoleKey}` },
  });
  if (!res.ok) throw new Error(`Couldn't clear old test people: ${res.status} ${await res.text()}`);
}

// SECOND_USER's share link path. They keep one list across runs: a run makes
// it with save_list_checked, as the app does, only when they have none yet.
async function secondUserShareLink(): Promise<string> {
  const { token, id } = await signInApi(SECOND_USER);
  const headers = {
    apikey: supabase.publishableKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const readToken = async (): Promise<string | null> => {
    const read = await fetch(
      `${supabase.url}/rest/v1/lists?select=share_token&owner_id=eq.${id}&order=created_at.asc&limit=1`,
      { headers: { ...headers, "Accept-Profile": "lists" } },
    );
    if (!read.ok) throw new Error(`Couldn't read the list: ${read.status} ${await read.text()}`);
    const rows = (await read.json()) as { share_token: string }[];
    return rows[0]?.share_token ?? null;
  };
  let shareToken = await readToken();
  if (!shareToken) {
    const saved = await fetch(`${supabase.url}/rest/v1/rpc/save_list_checked`, {
      method: "POST",
      headers: { ...headers, "Content-Profile": "lists" },
      body: JSON.stringify({
        p_list_id: null,
        p_title: null,
        p_items: [{ id: null, name: "Wool socks", price_cents: 1500, image_url: null, product_url: null, asin: null, source: "manual", added_at: null }],
        p_expected: null,
      }),
    });
    // 409-style refusal (GL409) means another run made it first: read it again.
    if (!saved.ok && !(await saved.text()).includes("GL409")) throw new Error(`Couldn't create a list: ${saved.status}`);
    shareToken = await readToken();
  }
  expect(shareToken).toBeTruthy();
  return `/share/${shareToken}`;
}

/** The person's birthday occasion, read with the service role (no RLS). */
async function birthdayRow(personId: string): Promise<{ id: string; month: number; day: number } | null> {
  const res = await fetch(
    `${supabase.url}/rest/v1/occasions?select=id,month,day&person_id=eq.${personId}&kind=eq.birthday&deleted_at=is.null`,
    { headers: { apikey: supabase.serviceRoleKey, Authorization: `Bearer ${supabase.serviceRoleKey}`, "Accept-Profile": "concierge" } },
  );
  const rows = (await res.json()) as { id: string; month: number; day: number }[];
  return rows[0] ?? null;
}

/** The person's saved birth year, read with the service role. */
async function birthYear(personId: string): Promise<number | null> {
  const res = await fetch(`${supabase.url}/rest/v1/people?select=birth_year&id=eq.${personId}`, {
    headers: { apikey: supabase.serviceRoleKey, Authorization: `Bearer ${supabase.serviceRoleKey}` },
  });
  return ((await res.json()) as { birth_year: number | null }[])[0].birth_year;
}

/** Adds a birthday the way About does, as the user. */
async function addBirthday(user: { email: string; password: string }, personId: string, month: number, day: number) {
  const { token, id } = await signInApi(user);
  const res = await fetch(`${supabase.url}/rest/v1/occasions`, {
    method: "POST",
    headers: {
      apikey: supabase.publishableKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Profile": "concierge",
    },
    body: JSON.stringify({ user_id: id, person_id: personId, kind: "birthday", month, day }),
  });
  if (!res.ok) throw new Error(`Couldn't add a birthday: ${res.status} ${await res.text()}`);
}

// The layout of each screen these journeys pass through, on every browser, in
// light and dark (ALL-127 AC-20). The journeys are behavior, so they run on the
// iPhone only (ALL-118).
test("the Add form, Home, a person's page, About and the moved screens fit the screen", { tag: "@layout" }, async ({ page }) => {
  // Sixteen page loads (eight screens, light and dark).
  test.slow();
  const user = await createFreshUser();
  const personId = await addMother(user, "Mom");
  await addBirthday(user, personId, 3, 14);
  // A long name, so the Saved gifts list is checked at its widest (ALL-93).
  await addSavedGift(user, personId, `Hand-tied fly-fishing reel with a spare spool and a carry case ${"x".repeat(56)}`);
  // A long Budget row (ALL-120): it's cut short, never pushed off the screen.
  await saveBudgets(user, personId, { any: 7500, christmas: 12500, mothers_day: 5050 });
  await signIn(page, user);
  // The full phone check (ALL-109): sideways scroll, small links, text past the edge.
  // Collected for every screen, so one run lists them all.
  const problems: string[] = [];
  const screens: [string, string, () => Promise<void>][] = [
    ["Add form", "/people/new", () => expect(page.getByRole("textbox", { name: "Name" })).toBeVisible()],
    ["Give", "/give", () => expect(page.getByRole("link", { name: "Mom", exact: true })).toBeVisible()],
    ["Person page", `/people/${personId}`, async () => {
      await expect(page.getByRole("link", { name: /^Budget/ })).toContainText("$75 · Christmas $125 · Mother's Day $50.50");
      await expect(page.getByRole("link", { name: /^About Mom/ })).toContainText("Mother · Birthday Mar 14");
      // The list prompt at the top (ALL-123), in place of the Their list row.
      await expect(page.getByRole("heading", { name: "Does Mom have a GiftsAF list?" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Their list link" })).toBeVisible();
    }],
    ["About", `/people/${personId}/about`, () => expect(page.getByRole("button", { name: "Remove birthday" })).toBeVisible()],
    ["Budget screen", `/people/${personId}/budget`, () => expect(page.getByRole("textbox", { name: "Any occasion" })).toBeVisible()],
    ["Saved gifts", `/people/${personId}/saved-gifts`, () => expect(page.getByRole("region", { name: "Saved gifts" }).getByRole("listitem")).toHaveCount(1)],
    ["Shipping address", `/people/${personId}/address`, () => expect(page.getByRole("button", { name: "Add an address" })).toBeVisible()],
  ];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [name, path, ready] of screens) {
      await page.goto(path);
      await ready();
      problems.push(...(await phoneLayoutProblems(page)).map((p) => `${name} (${scheme}): ${p}`));
    }
  }
  expect(problems).toEqual([]);
});

// ALL-127: About Mom saves each field as you go, with no Save button.
test("About Mom: each field saves on its own", async ({ page }) => {
  const user = await createFreshUser();
  const personId = await addMother(user, "Mom");
  await addBirthday(user, personId, 3, 14);
  const before = await birthdayRow(personId);
  await signIn(page, user);

  // Server actions this page sends, to count the date's saves.
  const saves: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) saves.push(r.url());
  });

  await page.goto(`/people/${personId}`);
  await page.getByRole("link", { name: /^About Mom/ }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}/about$`));
  const name = page.getByRole("textbox", { name: "Name" });
  // AC-8: the fields wait for the page to be ready.
  await expect(name).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);

  // AC-3: an empty name shows an error and saves nothing.
  await name.fill("");
  await name.press("Tab");
  await expect(page.getByRole("alert").filter({ hasText: "Enter a name." })).toBeVisible();

  // AC-2: a new name saves on leaving the field.
  await name.fill("Mama");
  await name.press("Tab");
  const nameField = page.getByTestId("name-field");
  await expect(nameField.getByRole("status")).toHaveText("Saved");

  // AC-4: Aunt saves when picked.
  await page.getByRole("combobox", { name: "Who are they to you?" }).selectOption({ label: "Aunt" });
  await expect(page.getByRole("combobox", { name: "Who are they to you?" }).locator("xpath=../..").getByRole("status")).toHaveText("Saved");

  // AC-5: Mar 14 → Nov → 30 → leave saves once, as Nov 30, moving the same occasion.
  const birthday = page.getByRole("group", { name: "Birthday" });
  saves.length = 0;
  await birthday.getByRole("combobox", { name: "Birthday month" }).selectOption({ label: "November" });
  await birthday.getByRole("spinbutton", { name: "Birthday day" }).fill("30");
  expect(saves).toEqual([]);
  await name.click();
  await expect(birthday.getByRole("status")).toHaveText("Saved");
  expect(saves).toHaveLength(1);
  expect(await birthdayRow(personId)).toEqual({ id: before!.id, month: 11, day: 30 });

  // AC-6: Feb 31 shows the error and saves nothing.
  saves.length = 0;
  await birthday.getByRole("combobox", { name: "Birthday month" }).selectOption({ label: "February" });
  await birthday.getByRole("spinbutton", { name: "Birthday day" }).fill("31");
  await name.click();
  await expect(birthday.getByRole("alert")).toHaveText("That date doesn't exist.");
  expect(saves).toEqual([]);
  expect(await birthdayRow(personId)).toMatchObject({ month: 11, day: 30 });

  // Back on her page, and on Home, the new name, relationship and date show.
  await page.getByRole("link", { name: "Mama" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Mama" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^About Mama/ })).toContainText("Aunt · Birthday Nov 30");
  await page.goto("/give");
  await expect(page.getByRole("link", { name: "Mama", exact: true })).toBeVisible();

  // AC-7: with a birth year saved, Remove birthday asks first, then removes the birthday and the year.
  await page.goto(`/people/${personId}/about`);
  const year = page.getByRole("spinbutton", { name: "Birth year (optional)" });
  await expect(year).toBeEnabled();
  await year.fill("1960");
  await year.press("Tab");
  await expect.poll(() => birthYear(personId)).toBe(1960);
  await page.getByRole("button", { name: "Remove birthday" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove birthday" }).click();
  await expect(page.getByRole("button", { name: "Remove birthday" })).toHaveCount(0);
  await expect.poll(() => birthdayRow(personId)).toBeNull();
  expect(await birthYear(personId)).toBeNull();
  await expect(year).toHaveValue("");
  await expect(year).toBeDisabled();
});

// Moving a birthday ends a round nobody chose from, and leaves a gift that's set where it is.
test("moving a birthday ends its open round, or says the gift keeps its date", async ({ page }) => {
  const buyer = await readyBuyer(await createFreshUser());
  const open = await personFor(buyer.id, "Olive");
  const { roundId } = await seedRound(buyer.id, open, { ideas: [{ title: "Vase", totalCents: 2000 }] });
  const set = await personFor(buyer.id, "Sage");
  const bought = await seedRound(buyer.id, set, { ideas: [{ title: "Lamp", totalCents: 2000 }] });
  const order = await seedFailedOrder(buyer.id, bought.roundId, bought.ideaIds[0], "price_up");
  await rest(`orders?id=eq.${order}`, { method: "PATCH", body: { status: "placed", failure_type: null } });
  await rest(`gift_rounds?id=eq.${bought.roundId}`, { method: "PATCH", body: { status: "ordered", attention_reason: null } });

  const day = (n: number) => {
    const d = new Date(Date.now() + n * 86_400_000);
    return { month: d.getUTCMonth() + 1, day: d.getUTCDate(), text: d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }) };
  };
  const moveTo = async (personId: string, to: ReturnType<typeof day>) => {
    await page.goto(`/people/${personId}/about`);
    const birthday = page.getByRole("group", { name: "Birthday" });
    await expect(birthday.getByRole("spinbutton", { name: "Birthday day" })).toBeEnabled();
    await birthday.getByRole("combobox", { name: "Birthday month" }).selectOption(String(to.month));
    await birthday.getByRole("spinbutton", { name: "Birthday day" }).fill(String(to.day));
    await page.getByRole("textbox", { name: "Name" }).click();
    await expect(birthday.getByText("Saved", { exact: true })).toBeVisible();
    return birthday;
  };

  await signIn(page, buyer.creds);
  await moveTo(open.personId, day(60));
  await page.goto(`/rounds/${roundId}`);
  await expect(page.getByText("The date changed, so this round ended.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Buy/ })).toHaveCount(0);

  const birthday = await moveTo(set.personId, day(45));
  await expect(birthday.getByText(`A gift is already set for ${day(50).text}. It keeps that date. It may arrive after the new date.`)).toBeVisible();
  expect(await rest(`gift_rounds?id=eq.${bought.roundId}&select=status`)).toEqual([{ status: "ordered" }]);
});

// ALL-127 AC-19: an "Add an address" email sent before this change links to
// the old page; it lands on the address screen, with the form open.
test("the old address email link lands on the address screen", async ({ page }) => {
  const user = await createFreshUser();
  const personId = await addMother(user, "Mom");
  await signIn(page, user);
  await page.goto(`/people/${personId}?address=open#address`);
  await expect(page).toHaveURL(new RegExp(`/people/${personId}/address\\?open=1`));
  await expect(page.getByRole("textbox", { name: "Street address" })).toBeVisible();
});

test("add Mom, set her occasions and budget, link her list, delete her", async ({ page }) => {
  // TEST_USER is shared with other specs, so a name no other spec uses.
  const mom = "Mom Journey";
  await deleteLeftovers(mom);
  await signIn(page);
  await page.goto("/give");

  // 1. Add her with only a name and Mother.
  await page.getByRole("link", { name: "Add someone you buy for" }).first().click();
  await page.getByLabel("Name").fill(mom);
  await page.getByLabel("Who are they to you?").selectOption({ label: "Mother" });
  await page.getByRole("button", { name: `Add ${mom}` }).click();

  // 2. Her card: Add birthday, a next occasion, and "We suggest ideas".
  await expect(page).toHaveURL(/\/give$/);
  const momLink = page.getByRole("link", { name: mom, exact: true });
  await expect(momLink).toBeVisible();
  const card = page.locator("div", { has: momLink }).last();
  await expect(card.getByRole("link", { name: "Add birthday" })).toBeVisible();
  await expect(card).toContainText(/Christmas|Mother's Day/);
  await expect(card).toContainText("We suggest ideas");

  // 2b. "Add birthday" opens About (ALL-127): the birthday saves on leaving the date.
  await card.getByRole("link", { name: "Add birthday" }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}\/about$/);
  const birthday = page.getByRole("group", { name: "Birthday" });
  await expect(birthday.getByRole("combobox", { name: "Birthday month" })).toBeEnabled();
  await birthday.getByRole("combobox", { name: "Birthday month" }).selectOption({ label: "April" });
  await birthday.getByRole("spinbutton", { name: "Birthday day" }).fill("2");
  await page.getByRole("textbox", { name: "Name" }).click();
  await expect(birthday.getByRole("status")).toHaveText("Saved");

  // 3. Her page: Christmas off; a $75 base and a $50 Mother's Day, then
  // Mother's Day emptied so it uses the base again (ALL-120).
  await page.getByRole("link", { name: mom }).first().click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: new RegExp(`^About ${mom}`) })).toContainText("Mother · Birthday Apr 2");
  const christmas = page.getByRole("switch", { name: "Christmas" });
  await expect(christmas).toBeChecked();
  await christmas.click();
  await expect(christmas).not.toBeChecked();

  const budgetRow = page.getByRole("link", { name: /^Budget/ });
  await expect(budgetRow).toContainText("Not set");
  await budgetRow.click();
  await expect(page).toHaveURL(/\/budget$/);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "Any occasion" }).fill("75");
  await page.getByRole("textbox", { name: "Mother's Day" }).fill("50");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  await expect(budgetRow).toContainText("$75 · Mother's Day $50");

  await budgetRow.click();
  await expect(page).toHaveURL(/\/budget$/);
  await expect(page.getByRole("textbox", { name: "Mother's Day" })).toHaveValue("50");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "Mother's Day" }).fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  await expect(budgetRow).toContainText("$75");
  await expect(budgetRow).not.toContainText("Mother's Day");

  // 4. SECOND_USER's list, linked by its share link in the prompt at the top (ALL-123): "Their own list".
  const sharePath = await secondUserShareLink();
  await expect(page.getByRole("link", { name: /^Their list/ })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Their list link" }).fill(new URL(sharePath, page.url()).toString());
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await expect(page.getByRole("link", { name: /^Their list/ })).toContainText("Linked");
  await expect(page.getByRole("heading", { name: `Does ${mom} have a GiftsAF list?` })).toHaveCount(0);
  await page.goto("/give");
  await expect(page.locator("div", { has: momLink }).last()).toContainText("Their own list");

  // 5. Delete her, behind the confirm. She's gone from Home.
  await momLink.click();
  await page.getByRole("button", { name: `Delete ${mom}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/give$/);
  await expect(page.getByRole("link", { name: mom, exact: true })).toHaveCount(0);
});

// ALL-121: an in-law saves through the real form and reads with hyphens on
// their page, starting with the parent's day.
test("add a mother-in-law", async ({ page }) => {
  await signIn(page, await createFreshUser());
  await page.goto("/people/new");
  // Typed before the page is ready, the name isn't in the button yet.
  await expect(page.getByRole("button", { name: "Add someone" })).toBeEnabled();
  await page.getByLabel("Name").fill("Linda");
  await page.getByLabel("Who are they to you?").selectOption({ label: "Mother-in-law" });
  await page.getByRole("button", { name: "Add Linda" }).click();
  await expect(page).toHaveURL(/\/give$/);
  await page.getByRole("link", { name: "Linda", exact: true }).click();
  // The line under her name: "Mother-in-law · Christmas, …".
  await expect(page.getByText(/^Mother-in-law ·/)).toBeVisible();
  await expect(page.getByRole("switch", { name: "Mother's Day" })).toBeChecked();
  // Saved and read back: About has her relationship selected.
  await page.getByRole("link", { name: /^About Linda/ }).click();
  await expect(page.getByRole("combobox", { name: "Who are they to you?" })).toHaveValue("mother_in_law");
});

// ALL-93: a gift saved by link and one by hand stay on the Saved gifts screen
// (its own route since ALL-127) after a reload, open the store page, and can be removed.
test("save a gift for someone, then remove it", async ({ page }) => {
  const user = await createFreshUser();
  const personId = await addMother(user, "Mom");
  await signIn(page, user);
  await page.goto(`/people/${personId}`);
  await expect(page.getByRole("link", { name: /^Saved gifts/ })).toContainText("None");
  await page.getByRole("link", { name: /^Saved gifts/ }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}/saved-gifts$`));
  const saved = page.getByRole("region", { name: "Saved gifts" });
  // Typed before the page is ready, nothing would be read from the link (ALL-110).
  await expect(saved.getByRole("button", { name: "Save" })).toBeEnabled();

  // 1. By link: the name comes from the link, the price is typed.
  await saved.getByLabel("Link").fill("https://www.amazon.com/Fly-Reel/dp/B0TESTREEL?ref=abc");
  // The link is read when you leave the field (or paste), not on each keystroke.
  await saved.getByLabel("Link").blur();
  await expect(saved.getByLabel("Gift")).not.toHaveValue("");
  await saved.getByLabel("Gift").fill("Fly-fishing reel");
  await saved.getByLabel("Price").fill("49");
  await saved.getByRole("button", { name: "Save" }).click();
  await expect(saved.getByRole("link", { name: "Fly-fishing reel" })).toBeVisible();

  // 2. By hand.
  await saved.getByLabel("Gift").fill("Coffee sampler");
  await saved.getByLabel("Price").fill("20");
  await saved.getByRole("button", { name: "Save" }).click();
  await expect(saved.getByText("Coffee sampler")).toBeVisible();

  // 3. Both are still there after a reload, newest first, with a clean link.
  await page.reload();
  const items = saved.getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Coffee sampler");
  await expect(items.nth(1)).toContainText("$49.00 · Amazon");
  const reel = saved.getByRole("link", { name: "Fly-fishing reel" });
  await expect(reel).toHaveAttribute("href", "https://www.amazon.com/dp/B0TESTREEL");
  await expect(reel).toHaveAttribute("target", "_blank");

  // 4. Remove the sampler; after a reload it's gone and the reel stays.
  await saved.getByRole("button", { name: "Remove Coffee sampler" }).click();
  await expect(saved.getByText("Coffee sampler")).toHaveCount(0);
  await page.reload();
  await expect(saved.getByRole("listitem")).toHaveCount(1);
  await expect(saved.getByRole("link", { name: "Fly-fishing reel" })).toBeVisible();

  // 5. Back on her page, the row counts what's saved.
  await page.getByRole("link", { name: "Mom", exact: true }).click();
  await expect(page.getByRole("link", { name: /^Saved gifts/ })).toContainText("1");
});
