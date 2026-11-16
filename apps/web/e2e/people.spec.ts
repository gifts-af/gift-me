import { expect, test } from "@playwright/test";
import { localSupabase } from "./local-supabase";
import { SECOND_USER, TEST_USER } from "./test-user";
import { createFreshUser } from "./fresh-user";
import { phoneLayoutProblems } from "./phone-layout";
import { addMother } from "./seed";
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

// SECOND_USER saves a list through the lists RPC, as the app does, and we
// return its share link path.
async function secondUserShareLink(): Promise<string> {
  const { token, id } = await signInApi(SECOND_USER);
  const headers = {
    apikey: supabase.publishableKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const saved = await fetch(`${supabase.url}/rest/v1/rpc/save_list`, {
    method: "POST",
    headers: { ...headers, "Content-Profile": "lists" },
    body: JSON.stringify({
      p_list_id: null,
      p_title: null,
      p_items: [{ id: null, name: "Wool socks", price_cents: 1500, image_url: null, product_url: null, asin: null, source: "manual", added_at: null }],
    }),
  });
  if (!saved.ok) throw new Error(`Couldn't create a list: ${saved.status} ${await saved.text()}`);
  const listId = (await saved.json()) as string;
  const read = await fetch(
    `${supabase.url}/rest/v1/lists?select=share_token&id=eq.${listId}&owner_id=eq.${id}`,
    { headers: { ...headers, "Accept-Profile": "lists" } },
  );
  const rows = (await read.json()) as { share_token: string }[];
  expect(rows).toHaveLength(1);
  return `/share/${rows[0].share_token}`;
}

// The layout of each screen this journey passes through, on every browser. The
// journey itself is behavior, so it runs on the iPhone only (ALL-118).
test("the Add form, Home with a card, and a person's page fit the screen", { tag: "@layout" }, async ({ page }) => {
  const user = await createFreshUser();
  const personId = await addMother(user, "Mom");
  await signIn(page, user);
  // The full phone check (ALL-109): sideways scroll, small links, text past the edge.
  // Collected for every screen, so one run lists them all.
  const problems: string[] = [];
  const check = async (screen: string) => problems.push(...(await phoneLayoutProblems(page)).map((p) => `${screen}: ${p}`));
  await page.goto("/people/new");
  await expect(page.getByLabel("Name")).toBeVisible();
  await check("Add form");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Mom", exact: true })).toBeVisible();
  await check("Home");
  await page.goto(`/people/${personId}`);
  await expect(page.getByRole("region", { name: "Your budget" })).toBeVisible();
  await check("Person page");
  expect(problems).toEqual([]);
});

test("add Mom, set her occasions and budget, link her list, delete her", async ({ page }) => {
  // TEST_USER is shared with other specs, so a name no other spec uses.
  const mom = "Mom Journey";
  await deleteLeftovers(mom);
  await signIn(page);
  await page.goto("/");

  // 1. Add her with only a name and Mother.
  await page.getByRole("link", { name: "Add someone you buy for" }).first().click();
  await page.getByLabel("Name").fill(mom);
  await page.getByLabel("Who are they to you?").selectOption({ label: "Mother" });
  await page.getByRole("button", { name: `Add ${mom}` }).click();

  // 2. Her card: Add birthday, a next occasion, and "We suggest ideas".
  await expect(page).toHaveURL(/\/$/);
  const momLink = page.getByRole("link", { name: mom, exact: true });
  await expect(momLink).toBeVisible();
  const card = page.locator("div", { has: momLink }).last();
  await expect(card.getByRole("link", { name: "Add birthday" })).toBeVisible();
  await expect(card).toContainText(/Christmas|Mother's Day/);
  await expect(card).toContainText("We suggest ideas");

  // 3. Her page: Christmas off, a $75 Mother's Day budget, then cleared.
  await momLink.click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  const christmas = page.getByRole("switch", { name: "Christmas" });
  await expect(christmas).toBeChecked();
  await christmas.click();
  await expect(christmas).not.toBeChecked();

  const budgets = page.getByRole("region", { name: "Your budget" });
  await budgets.getByRole("button", { name: "Set Mother's Day budget" }).click();
  await budgets.getByLabel("Mother's Day budget").fill("75");
  await budgets.getByRole("button", { name: "Save", exact: true }).click();
  await expect(budgets.getByText("$75", { exact: true })).toBeVisible();

  await budgets.getByRole("button", { name: "Edit Mother's Day budget" }).click();
  await budgets.getByLabel("Mother's Day budget").fill("");
  await budgets.getByRole("button", { name: "Save", exact: true }).click();
  await expect(budgets.getByRole("listitem").filter({ hasText: "Mother's Day" }).getByText("Not set")).toBeVisible();
  await expect(budgets.getByRole("button", { name: "Set Mother's Day budget" })).toBeVisible();

  // 4. SECOND_USER's list, linked by its share link: "Their own list".
  const sharePath = await secondUserShareLink();
  await page.getByLabel("Their list link").fill(new URL(sharePath, page.url()).toString());
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await expect(page.getByText("Linked.")).toBeVisible();
  await page.goto("/");
  await expect(page.locator("div", { has: momLink }).last()).toContainText("Their own list");

  // 5. Delete her, behind the confirm. She's gone from Home.
  await momLink.click();
  await page.getByRole("button", { name: `Delete ${mom}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
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
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Linda", exact: true }).click();
  // The line under her name: "Mother-in-law · Christmas, …".
  await expect(page.getByText(/^Mother-in-law ·/)).toBeVisible();
  await expect(page.getByRole("switch", { name: "Mother's Day" })).toBeChecked();
});
