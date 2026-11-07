import { expect, test, type Locator, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { phoneLayoutProblems } from "./phone-layout";
import { saveOneGiftList } from "./seed";
import { signIn } from "./sign-in";

// ALL-63: your own address and sharing it, against the local Supabase. Every
// test makes its own accounts, because the table has one row per account and
// tests run in parallel. Never turn sharing on for the shared test users: it
// would change other specs' person pages. One test checks the new screens'
// layout on every browser (@layout, T62); the rest run on the iPhone.
const supabase = localSupabase();
const service = {
  apikey: supabase.serviceRoleKey,
  Authorization: `Bearer ${supabase.serviceRoleKey}`,
  "Content-Type": "application/json",
};
const STREET = "44 Elm St";

type User = { email: string; password: string };
type Row = { city: string; address_line1: string; share_for_gifts: boolean; country: string; phone: string | null; address_checked_at: string | null };

async function userId(user: User): Promise<string> {
  const res = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabase.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error(`Couldn't sign in: ${res.status}`);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

async function row(id: string): Promise<Row | null> {
  const res = await fetch(`${supabase.url}/rest/v1/account_addresses?user_id=eq.${id}`, { headers: service });
  const rows = (await res.json()) as Row[];
  return rows[0] ?? null;
}

async function seedAddress(id: string, share: boolean) {
  const res = await fetch(`${supabase.url}/rest/v1/account_addresses`, {
    method: "POST",
    headers: service,
    body: JSON.stringify({
      user_id: id,
      recipient_first_name: "Sam",
      recipient_last_name: "Rivera",
      address_line1: STREET,
      city: "Columbus",
      state: "OH",
      zip: "43215",
      share_for_gifts: share,
    }),
  });
  if (!res.ok) throw new Error(`Couldn't seed an address: ${res.status} ${await res.text()}`);
}

async function deleteAddress(id: string) {
  await fetch(`${supabase.url}/rest/v1/account_addresses?user_id=eq.${id}`, { method: "DELETE", headers: service });
}

async function saveFirstList(page: Page) {
  await page.goto("/lists");
  await page.getByRole("button", { name: "Add by hand" }).click();
  await page.getByLabel("Gift name").fill("Wool socks");
  await page.getByLabel("Price").fill("12");
  await page.getByRole("button", { name: "Add to list" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
}

async function fillAddress(page: Page) {
  await page.getByLabel("First name").fill("Sam");
  await page.getByLabel("Last name").fill("Rivera");
  await page.getByLabel("Street address").fill(STREET);
  await page.getByLabel("City").fill("Columbus");
  await page.getByLabel("State").selectOption("OH");
  await page.getByLabel("ZIP code").fill("43215");
}

// A tap before React attaches to the page does nothing, so wait for that rather
// than retrying, which could hide a tap that really failed.
async function tap(target: Locator) {
  await expect
    .poll(() => target.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))))
    .toBe(true);
  await target.click();
}

const shareSwitch = (page: Page) => page.getByRole("switch", { name: "Let people with my list ship gifts to me" });

// The new screens' layout on every browser (T62), in each state the journeys
// below pass through. The journeys are behavior, so they run on the iPhone only (ALL-118).
test("My address and the share switch fit the screen, in every state", { tag: "@layout" }, async ({ page }) => {
  const user = await createFreshUser();
  const id = await userId(user);
  await saveOneGiftList(user);
  await signIn(page, user);

  // Settings: no address yet, then the open form.
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Add my address" })).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await tap(page.getByRole("button", { name: "Add my address" }));
  await expect(page.getByLabel("First name")).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);

  // My list: the switch, then its form with an error showing.
  await page.goto("/lists");
  await expect(shareSwitch(page)).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await tap(shareSwitch(page));
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("ZIP code").fill("1");
  await dialog.getByRole("button", { name: "Save and share" }).click();
  await expect(dialog.getByText("Enter a 5-digit ZIP code.")).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);

  // A saved address: shared on My list, and in Settings.
  await seedAddress(id, true);
  await page.goto("/lists");
  await expect(page.getByText(/^They see Columbus, OH in GiftsAF\./)).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await page.goto("/settings");
  await expect(page.getByText(STREET)).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
});

test("My address waits for a list, then adds, changes and removes (AC-1 to AC-5)", async ({ page }) => {
  const user = await createFreshUser();
  const id = await userId(user);
  await signIn(page, user);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Time zone")).toBeVisible();
  await expect(page.getByRole("heading", { name: "My address" })).toHaveCount(0);

  await saveFirstList(page);
  await page.goto("/settings");
  await tap(page.getByRole("button", { name: "Add my address" }));
  await expect(page.getByLabel("First name")).toHaveValue("");

  await page.getByLabel("ZIP code").fill("123");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText("Add your first name.")).toBeVisible();
  await expect(page.getByText("Enter a 5-digit ZIP code.")).toBeVisible();
  await expect(page.getByLabel("ZIP code")).toHaveValue("123");
  expect(await row(id)).toBeNull();

  await fillAddress(page);
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText(`${STREET}`)).toBeVisible();
  await expect(page.getByText(/^Not shared\./)).toBeVisible();
  const saved = await row(id);
  expect(saved).toMatchObject({ share_for_gifts: false, country: "US", phone: null });
  expect(saved?.address_checked_at).not.toBeNull();

  await page.getByRole("button", { name: "Change address" }).click();
  await page.getByLabel("City").fill("Dayton");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText("Dayton, OH 43215")).toBeVisible();
  expect((await row(id))?.city).toBe("Dayton");

  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await row(id)).not.toBeNull();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Remove address" }).click();
  await expect(page.getByRole("button", { name: "Add my address" })).toBeVisible();
  expect(await row(id)).toBeNull();
});

test("changing an address keeps sharing on (AC-3)", async ({ page }) => {
  const user = await createFreshUser();
  const id = await userId(user);
  await seedAddress(id, true);
  await signIn(page, user);
  await saveFirstList(page);
  await page.goto("/settings");
  await expect(page.getByText(/^Shared with people who have your list\./)).toBeVisible();
  await tap(page.getByRole("button", { name: "Change address" }));
  await page.getByLabel("City").fill("Dayton");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText("Dayton, OH 43215")).toBeVisible();
  const changed = await row(id);
  expect(changed).toMatchObject({ city: "Dayton", share_for_gifts: true });
  expect(changed?.address_checked_at).not.toBeNull();

  // Removing it and adding it again starts with sharing off (AC-5).
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Remove address" }).click();
  await page.getByRole("button", { name: "Add my address" }).click();
  await fillAddress(page);
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText(/^Not shared\./)).toBeVisible();
  expect(await row(id)).toMatchObject({ share_for_gifts: false });
});

test("the switch appears with a first list, asks once, then turns off and on (AC-7, AC-8, AC-9, AC-11)", async ({ page }) => {
  const user = await createFreshUser();
  const id = await userId(user);
  await signIn(page, user);

  await page.goto("/lists");
  await expect(page.getByRole("button", { name: "Add by hand" })).toBeVisible();
  await expect(shareSwitch(page)).toHaveCount(0);

  await saveFirstList(page);
  await expect(shareSwitch(page)).toBeVisible();
  await expect(shareSwitch(page)).not.toBeChecked();

  await shareSwitch(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(shareSwitch(page)).not.toBeChecked();
  expect(await row(id)).toBeNull();

  await shareSwitch(page).click();
  await dialog.getByLabel("ZIP code").fill("1");
  await dialog.getByRole("button", { name: "Save and share" }).click();
  await expect(dialog.getByText("Enter a 5-digit ZIP code.")).toBeVisible();
  expect(await row(id)).toBeNull();

  await fillAddress(page);
  await dialog.getByRole("button", { name: "Save and share" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(shareSwitch(page)).toBeChecked();
  await expect(page.getByText(/^They see Columbus, OH in GiftsAF\./)).toBeVisible();
  expect(await row(id)).toMatchObject({ share_for_gifts: true, address_line1: STREET });

  await shareSwitch(page).click();
  await expect(shareSwitch(page)).not.toBeChecked();
  expect(await row(id)).toMatchObject({ share_for_gifts: false, address_line1: STREET });

  await shareSwitch(page).click();
  await expect(shareSwitch(page)).toBeChecked();
  expect(await row(id)).toMatchObject({ share_for_gifts: true });
});

test("a stale switch gets a plain message and writes nothing (AC-10)", async ({ page }) => {
  const user = await createFreshUser();
  const id = await userId(user);
  await signIn(page, user);
  await saveFirstList(page);
  await seedAddress(id, false);
  await page.reload();
  await expect(shareSwitch(page)).not.toBeChecked();
  await deleteAddress(id);
  await tap(shareSwitch(page));
  await expect(page.getByText("Add your address first.")).toBeVisible();
  expect(await row(id)).toBeNull();
});

test("turning a stale switch off, with the address already removed, isn't an error", async ({ page }) => {
  const user = await createFreshUser();
  const id = await userId(user);
  await signIn(page, user);
  await saveFirstList(page);
  await seedAddress(id, true);
  await page.reload();
  await expect(shareSwitch(page)).toBeChecked();
  await deleteAddress(id);
  await tap(shareSwitch(page));
  await expect(shareSwitch(page)).not.toBeChecked();
  await expect(page.getByText("Add your address first.")).toHaveCount(0);
  await shareSwitch(page).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Where should gifts ship?" })).toBeVisible();
});

test("the list page never carries the street or name (AC-12)", async ({ page }) => {
  const user = await createFreshUser();
  const id = await userId(user);
  await signIn(page, user);
  await saveFirstList(page);
  await seedAddress(id, true);
  // A fresh request: a page reached by client navigation keeps hidden routes in its DOM.
  const html = await (await page.request.get("/lists")).text();
  expect(html).toContain("Columbus");
  expect(html).not.toContain(STREET);
  expect(html).not.toContain("Rivera");
});

test("Settings shows the new address after sharing from the list, with the form closed", async ({ page }) => {
  const user = await createFreshUser();
  await signIn(page, user);
  await saveFirstList(page);
  await page.goto("/settings");
  await tap(page.getByRole("button", { name: "Add my address" }));
  await expect(page.getByLabel("First name")).toBeVisible();

  await page.getByRole("link", { name: "Get", exact: true }).click();
  await shareSwitch(page).click();
  await fillAddress(page);
  await page.getByRole("dialog").getByRole("button", { name: "Save and share" }).click();
  await expect(shareSwitch(page)).toBeChecked();

  await page.getByRole("link", { name: "Change my address" }).click();
  await expect(page.getByRole("heading", { name: "My address" })).toBeInViewport();
  await expect(page.getByText(STREET)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save address" })).toHaveCount(0);
});

test("a linked buyer sees only the city, and nothing once sharing stops (AC-13, AC-14)", async ({ page, browser }) => {
  const owner = await createFreshUser();
  const ownerId = await userId(owner);
  const buyer = await createFreshUser();
  const buyerId = await userId(buyer);

  await signIn(page, owner);
  await saveFirstList(page);
  await seedAddress(ownerId, true);
  const lists = await fetch(`${supabase.url}/rest/v1/lists?select=share_token&owner_id=eq.${ownerId}`, {
    headers: { ...service, "Accept-Profile": "lists" },
  });
  const [{ share_token }] = (await lists.json()) as { share_token: string }[];

  const added = await fetch(`${supabase.url}/rest/v1/people`, {
    method: "POST",
    headers: { ...service, Prefer: "return=representation" },
    body: JSON.stringify({ user_id: buyerId, name: "Sam", relationship: "friend" }),
  });
  if (!added.ok) throw new Error(`Couldn't add a person: ${added.status} ${await added.text()}`);
  const [{ id: personId }] = (await added.json()) as { id: string }[];

  const context = await browser.newContext({ viewport: page.viewportSize() });
  const buyerPage = await context.newPage();
  await signIn(buyerPage, buyer);
  await buyerPage.goto(`/people/${personId}`);
  const linkField = buyerPage.getByLabel("Their list link");
  await linkField.fill(`${new URL(page.url()).origin}/share/${share_token}`);
  await expect.poll(() => linkField.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps")))).toBe(true);
  await linkField.press("Enter");

  const line = "Gifts ship to Sam's own address in Columbus, OH. They keep it up to date.";
  await expect(buyerPage.getByText(line)).toBeVisible();
  expect(await (await buyerPage.request.get(`/people/${personId}`)).text()).not.toContain(STREET);

  await page.goto("/lists");
  await tap(shareSwitch(page));
  await expect(shareSwitch(page)).not.toBeChecked();
  await buyerPage.reload();
  await expect(buyerPage.getByRole("button", { name: "Add an address" })).toBeVisible();
  await expect(buyerPage.getByText("Columbus")).toHaveCount(0);

  await shareSwitch(page).click();
  await expect(shareSwitch(page)).toBeChecked();
  await buyerPage.reload();
  await expect(buyerPage.getByText(line)).toBeVisible();

  await deleteAddress(ownerId);
  await buyerPage.reload();
  await expect(buyerPage.getByRole("button", { name: "Add an address" })).toBeVisible();
  await context.close();
});
