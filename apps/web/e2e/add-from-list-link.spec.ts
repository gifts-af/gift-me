import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { phoneLayoutProblems } from "./phone-layout";
import { session, signIn, type Credentials } from "./sign-in";

// ALL-123: open someone's share link, add them to your people with their list
// linked in one save, see the same list screen from their page, and remove the
// link. Plus what the list's owner and a signed-out visitor see. Fresh accounts,
// so no other spec's people or lists get in the way.

const supabase = localSupabase();

/** A fresh owner with a display name and a one-gift list; returns them and the share path. */
async function ownerWithList(longName = false): Promise<{ owner: Credentials; name: string; sharePath: string }> {
  // A name no other run uses, so the heading check can't match a leftover.
  const name = `${longName ? "Maximiliana Featherstonehaugh" : "Sam"} ${randomUUID().slice(0, 8)}`;
  const owner = await createFreshUser(name);
  const { access_token, user } = await session(owner);
  const headers = {
    apikey: supabase.publishableKey,
    Authorization: `Bearer ${access_token}`,
    "Content-Type": "application/json",
  };
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
  if (!saved.ok) throw new Error(`Couldn't create a list: ${saved.status} ${await saved.text()}`);
  const listId = ((await saved.json()) as { id: string }).id;
  const read = await fetch(`${supabase.url}/rest/v1/lists?select=share_token&id=eq.${listId}&owner_id=eq.${user.id}`, {
    headers: { ...headers, "Accept-Profile": "lists" },
  });
  const rows = (await read.json()) as { share_token: string }[];
  expect(rows).toHaveLength(1);
  return { owner, name, sharePath: `/share/${rows[0].share_token}` };
}

const card = (page: Page) => page.getByRole("region", { name: "This list and your people" });

test("add a list's owner from their link, open their list from their page, and remove the link", async ({ page }) => {
  const { name, sharePath } = await ownerWithList();
  await signIn(page, await createFreshUser());

  // 1. The share link: whose list it is, and the add card (AC-1, AC-6).
  await page.goto(sharePath);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name}'s list`);
  await card(page).getByRole("link", { name: `Add ${name} to your people` }).click();

  // 2. The form starts with their name; the relationship is asked as usual (AC-7).
  await expect(page).toHaveURL(/\/people\/new\?list=/);
  await expect(page.getByLabel("Name")).toHaveValue(name);
  await expect(page.getByRole("main").getByText("If a gift for them is waiting on an address, it will ship to this list's owner.")).toBeVisible();
  await page.getByLabel("Who are they to you?").selectOption({ label: "Mother" });
  await page.getByRole("button", { name: `Add ${name}` }).click();

  // 3. Their page, with the list already linked in the same save (AC-8).
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  const personUrl = page.url();
  const theirList = page.getByRole("link", { name: /^Their list/ });
  await expect(theirList).toContainText("Linked");
  await expect(page.getByRole("heading", { name: `Does ${name} have a GiftsAF list?` })).toHaveCount(0);

  // 4. Their list is the same screen as the share link, with Remove (AC-5).
  await theirList.click();
  await expect(page).toHaveURL(new RegExp(`${sharePath}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name}'s list`);
  await expect(page.getByRole("button", { name: "Claim Wool socks" })).toBeVisible();
  await expect(card(page)).toContainText(`${name} is in your people`);
  await expect(card(page).getByRole("link", { name })).toHaveAttribute("href", new URL(personUrl).pathname);

  // 5. Remove, then Cancel: nothing changes (AC-11).
  await card(page).getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(card(page)).toContainText(`${name} is in your people`);

  // 6. Remove, then Unlink: the add card comes back (AC-12).
  await card(page).getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Unlink" }).click();
  await expect(card(page).getByRole("link", { name: `Add ${name} to your people` })).toBeVisible();

  // 7. They're still in your people, now with the prompt to link a list (AC-12, AC-14).
  await page.goto(personUrl);
  await expect(page.getByRole("heading", { name: `Does ${name} have a GiftsAF list?` })).toBeVisible();
});

test("the owner opening their own link sees their list title and no card", async ({ page }) => {
  const { owner, sharePath } = await ownerWithList();
  await signIn(page, owner);
  await page.goto(sharePath);
  // AC-4: their own title, the owner banner, and no add/link/remove card.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My list");
  await expect(page.getByText("This is your list.")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test("a signed-out visitor sees Sign in, which returns to the list, and Request access", async ({ page }) => {
  const { name, sharePath } = await ownerWithList();
  await page.goto(sharePath);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name}'s list`);
  // AC-13, AC-24: sign in returns to this page; Request access never carries the token.
  const next = `next=${encodeURIComponent(sharePath)}`;
  await expect(card(page).getByRole("link", { name: `Add ${name} to your people` })).toHaveAttribute("href", `/auth/login?${next}`);
  await expect(card(page).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/auth/login?${next}`);
  await expect(card(page).getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/request-access");
});

// AC-18: the card fits a phone and desktop, light and dark (T62). A long name,
// so the "Add … to your people" button has to wrap (it ran off a phone in CI).
test("the card on a shared list fits the screen", { tag: "@layout" }, async ({ page }) => {
  const { name, sharePath } = await ownerWithList(true);
  await signIn(page, await createFreshUser());
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(sharePath);
    await expect(card(page).getByRole("link", { name: `Add ${name} to your people` })).toBeVisible();
    expect(await phoneLayoutProblems(page)).toEqual([]);
  }
});
