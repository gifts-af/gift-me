import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { phoneLayoutProblems } from "./phone-layout";
import { saveOneGiftList } from "./seed";
import { session, signIn, type Credentials } from "./sign-in";

// Your own birthday, saved in Settings and filled in for people adding you
// from your list, against the local Supabase. Fresh accounts: one row each.
const supabase = localSupabase();

async function sharePath(user: Credentials): Promise<string> {
  const { access_token, user: me } = await session(user);
  const read = await fetch(`${supabase.url}/rest/v1/lists?select=share_token&owner_id=eq.${me.id}`, {
    headers: { apikey: supabase.publishableKey, Authorization: `Bearer ${access_token}`, "Accept-Profile": "lists" },
  });
  return `/share/${((await read.json()) as { share_token: string }[])[0].share_token}`;
}

async function openAddForm(page: Page, path: string, as: Credentials) {
  await page.context().clearCookies();
  await signIn(page, as);
  await page.goto(`/people/new?list=${path.split("/").pop()}`);
  await expect(page.getByLabel("Name")).toHaveValue("Sam");
}

test("save a birthday after sharing, and someone adding you gets it, until you remove it", async ({ page }) => {
  const sam = await createFreshUser("Sam");
  await saveOneGiftList(sam);
  const path = await sharePath(sam);
  await signIn(page, sam);

  // Settings has it as not added; Share mentions it only once used (AC-1, AC-13).
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /Birthday/ })).toContainText("Not added");
  await page.goto("/lists");
  await expect(page.getByText("No birthday saved.")).toHaveCount(0);
  await page.getByRole("button", { name: /^(Share|Copied!)$/ }).click();
  await page.getByRole("link", { name: "No birthday saved. Add it (optional)" }).click();

  // The Birthday screen saves it (AC-2).
  await expect(page).toHaveURL(/\/settings\/birthday$/);
  await page.getByLabel("Birthday month").selectOption("March");
  await page.getByLabel("Birthday day").fill("14");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /Birthday/ })).toContainText("Mar 14");
  await page.goto("/lists");
  await page.getByRole("button", { name: /^(Share|Copied!)$/ }).click();
  await expect(page.getByText("No birthday saved.")).toHaveCount(0);

  // Someone adding Sam finds it, and what's on the form is saved (AC-5).
  const buyer = await createFreshUser();
  await openAddForm(page, path, buyer);
  await expect(page.getByLabel("Birthday month")).toHaveValue("3");
  await expect(page.getByLabel("Birthday day")).toHaveValue("14");
  await page.getByLabel("Who are they to you?").selectOption({ label: "Friend" });
  await page.getByRole("button", { name: "Add Sam" }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);

  // Removed, it fills in for nobody new, and the buyer keeps theirs (AC-4, AC-7).
  await page.context().clearCookies();
  await signIn(page, sam);
  await page.goto("/settings/birthday");
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Removed$/ })).toBeVisible();
  await openAddForm(page, path, await createFreshUser());
  await expect(page.getByLabel("Birthday month")).toHaveValue("");
  const { access_token } = await session(buyer);
  const occasions = await fetch(`${supabase.url}/rest/v1/occasions?select=month,day&kind=eq.birthday`, {
    headers: { apikey: supabase.publishableKey, Authorization: `Bearer ${access_token}`, "Accept-Profile": "concierge" },
  });
  expect(await occasions.json()).toEqual([{ month: 3, day: 14 }]);
});

test("with no list there's no Birthday row, and its screen goes back to Settings", async ({ page }) => {
  await signIn(page, await createFreshUser("Sam"));
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /^Name/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Birthday/ })).toHaveCount(0);
  await page.goto("/settings/birthday");
  await expect(page).toHaveURL(/\/settings$/);
});

test("the Birthday screen and the note under Share fit", { tag: "@layout" }, async ({ page }) => {
  const sam = await createFreshUser("Sam");
  await saveOneGiftList(sam);
  await signIn(page, sam);
  await page.goto("/settings/birthday");
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  // A long summary line, at the narrowest phone: the note must not push the list down.
  const { access_token } = await session(sam);
  await fetch(`${supabase.url}/rest/v1/list_items?name=eq.Wool%20socks`, {
    method: "PATCH",
    headers: { apikey: supabase.publishableKey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json", "Content-Profile": "lists" },
    body: JSON.stringify({ price_cents: 124000 }),
  });
  // The same on every browser, whatever its clipboard rules.
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } }));
  const size = page.viewportSize()!;
  if (size.width < 640) await page.setViewportSize({ width: 360, height: size.height });
  await page.goto("/lists");
  await expect(page.getByText("$1,240.00").first()).toBeVisible();
  const gift = page.getByRole("heading", { level: 3, name: "Wool socks" });
  const before = (await gift.boundingBox())!.y;
  await page.getByRole("button", { name: /^(Share|Copied!)$/ }).click();
  await expect(page.getByText("No birthday saved.")).toBeVisible();
  expect((await gift.boundingBox())!.y).toBe(before);
  const summary = (await page.getByText("$1,240.00").first().boundingBox())!;
  const note = (await page.getByRole("link", { name: /No birthday saved/ }).boundingBox())!;
  expect(Math.abs(note.y + note.height / 2 - (summary.y + summary.height / 2))).toBeLessThan(6);
  expect(await phoneLayoutProblems(page)).toEqual([]);
});
