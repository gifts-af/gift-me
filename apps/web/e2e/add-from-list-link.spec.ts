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
  const theirList = page.getByRole("link", { name: "See their list" });
  await expect(theirList).toBeVisible();
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

test("a signed-out visitor sees sign-up and sign-in, which both return to the list (AC-2)", async ({ page }) => {
  const { name, sharePath } = await ownerWithList();
  await page.goto(sharePath);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name}'s list`);
  const next = `next=${encodeURIComponent(sharePath)}`;
  await expect(card(page).getByRole("link", { name: `Add ${name} to your people` })).toHaveAttribute("href", `/auth/sign-up?${next}`);
  await expect(card(page).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/auth/login?${next}`);
  await expect(card(page).getByRole("link")).toHaveCount(2);
  await expect(page.locator("body")).not.toContainText(/invite only/i);
});

// A guest's claim doesn't just close the box; it offers their own list.
test("a signed-out visitor who claims a gift is offered their own list, and the claim stays", async ({ page }) => {
  const { name, sharePath } = await ownerWithList();
  await page.goto(sharePath);
  await page.getByRole("button", { name: "Claim Wool socks" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your name").fill("Jordan");
  await dialog.getByRole("button", { name: "Claim gift" }).click();

  const offer = page.getByRole("dialog", { name: `Claimed. ${name} won't see it.` });
  await expect(offer).toBeVisible();
  await expect(offer.getByRole("link", { name: "Start yours, free" })).toHaveAttribute("href", "/auth/sign-up?next=%2Flists");
  await expect(offer).toContainText("Your claim stays a guest claim, so it can't be undone.");
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toBeHidden();
  await expect(page.getByText("Claimed by Jordan")).toBeVisible();
});

test("a signed-out relative signs in from a shared list and lands back on it (AC-2)", async ({ page }) => {
  const { name, sharePath } = await ownerWithList();
  const user = await createFreshUser(undefined, { access: false });
  await page.goto(sharePath);
  await card(page).getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(user.email);
  // eslint-disable-next-line no-restricted-syntax -- this tests where the sign-in form takes you
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${sharePath}$`));
  await expect(card(page).getByRole("link", { name: `Add ${name} to your people` })).toHaveAttribute("href", /^\/people\/new\?list=/);
});

test("a signed-out relative signs up by email, confirms in another browser, and lands signed in on the list (AC-2)", async ({ page, browser, baseURL }) => {
  const { name, sharePath } = await ownerWithList();
  const email = `e2e-${randomUUID()}@example.test`;
  const password = "e2e-local-only-password";

  // The local stack confirms accounts itself, so the sign-up request is held here, and the link
  // production's email would carry is made below from what it asked for.
  let redirectTo = null as string | null;
  await page.route("**/auth/v1/signup*", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    redirectTo = new URL(route.request().url()).searchParams.get("redirect_to");
    await route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: { id: randomUUID(), aud: "authenticated", email, identities: [] } });
  });
  await page.goto(sharePath);
  await card(page).getByRole("link", { name: `Add ${name} to your people` }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up\?next=/);
  await page.getByLabel("Email").fill(email);
  // eslint-disable-next-line no-restricted-syntax -- this tests the sign-up form
  await page.getByLabel("Password", { exact: true }).fill(password);
  // eslint-disable-next-line no-restricted-syntax -- as above
  await page.getByLabel("Repeat password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up-success\?next=/);
  await expect(page.getByText("Check your email for a link to confirm your account.")).toBeVisible();
  expect(redirectTo).toBe(new URL(sharePath, baseURL).href);

  const made = await fetch(`${supabase.url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: supabase.serviceRoleKey, Authorization: `Bearer ${supabase.serviceRoleKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "signup", email, password }),
  });
  expect(made.ok).toBe(true);
  const { hashed_token } = (await made.json()) as { hashed_token: string };

  // {{ .SiteURL }}/auth/confirm?token_hash=...&type=email&next={{ .RedirectTo }}
  const elsewhere = await browser.newContext({ baseURL });
  try {
    const other = await elsewhere.newPage();
    await other.goto(`/auth/confirm?token_hash=${hashed_token}&type=email&next=${redirectTo}`);
    await expect(other).toHaveURL(new RegExp(`${sharePath}$`));
    await expect(card(other).getByRole("link", { name: `Add ${name} to your people` })).toHaveAttribute("href", /^\/people\/new\?list=/);
  } finally {
    await elsewhere.close();
  }
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
