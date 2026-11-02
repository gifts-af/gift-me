import { expect, test, type Page } from "@playwright/test";
import { localSupabase } from "./local-supabase";
import { TEST_USER } from "./test-user";

// ALL-24: import people from Google Contacts. Google's sign-in script and the
// People API are replaced with fakes at the network level, so the real page,
// server action and database run end to end. Photos aren't covered here: the
// server fetches them, out of the browser's reach (unit tests cover them).
const supabase = localSupabase();

// A stand-in for Google Identity Services: grants the contacts scope at once,
// and records what was revoked.
const FAKE_GIS = `
  window.__revoked = [];
  window.google = { accounts: { oauth2: {
    initTokenClient: (c) => ({ requestAccessToken: () => setTimeout(() =>
      c.callback({ access_token: "fake-token", scope: c.scope }), 0) }),
    hasGrantedAllScopes: (r, s) => (r.scope || "").split(" ").includes(s),
    revoke: (t, done) => { window.__revoked.push(t); done && done(); },
  } } };
`;

async function signIn(page: Page) {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
}

// Removes people a failed earlier run left behind (service role, so no RLS).
async function deleteLeftovers(names: string[]) {
  const res = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabase.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
  });
  const { user } = (await res.json()) as { user: { id: string } };
  const list = names.map((n) => `"${n}"`).join(",");
  const del = await fetch(`${supabase.url}/rest/v1/people?user_id=eq.${user.id}&name=in.(${encodeURIComponent(list)})`, {
    method: "DELETE",
    headers: { apikey: supabase.serviceRoleKey, Authorization: `Bearer ${supabase.serviceRoleKey}` },
  });
  if (!del.ok) throw new Error(`Couldn't clear old test people: ${del.status} ${await del.text()}`);
}

test("import Grandma and a friend from Google Contacts, then see them as already added", async ({ page }, testInfo) => {
  // The projects run at once as the same user, so each imports its own contacts.
  const tag = testInfo.project.name;
  const n = { android: 1, iphone: 2, desktop: 3 }[tag] ?? 9;
  const grandma = `Grandma Rose ${tag}`;
  const chris = `Chris Park ${tag}`;
  const stranger = `Unticked Stranger ${tag}`;
  await deleteLeftovers([grandma, chris, stranger]);

  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ contentType: "text/javascript", body: FAKE_GIS }),
  );
  await page.route("https://people.googleapis.com/v1/people/me/connections**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        connections: [
          {
            resourceName: `people/c${n}01`,
            names: [{ displayName: grandma, givenName: "Rose", familyName: "Allen" }],
            birthdays: [{ date: { month: 6, day: 2, year: 1950 } }],
            addresses: [{ streetAddress: "9 Oak Ave", city: "Dayton", region: "OH", postalCode: "45402", countryCode: "US" }],
          },
          { resourceName: `people/c${n}02`, names: [{ displayName: chris }] },
          { resourceName: `people/c${n}03`, names: [{ displayName: stranger }] },
        ],
      }),
    }),
  );
  const sentRows: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/people/import")) sentRows.push(r.postData() ?? "");
  });

  await signIn(page);
  await page.getByRole("link", { name: "Import from Google" }).click();
  await expect(page.getByRole("heading", { name: "Who do you buy gifts for?" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Google Contacts" }).click();

  await page.getByRole("checkbox", { name: grandma }).check();
  await expect(page.getByRole("combobox", { name: `Who is ${grandma} to you?` })).toHaveValue("grandmother");
  await page.getByRole("checkbox", { name: chris }).check();
  await expect(page.getByRole("button", { name: "Add 2 people" })).toBeDisabled();
  await page.getByRole("combobox", { name: `Who is ${chris} to you?` }).selectOption({ label: "Friend" });
  await page.getByRole("button", { name: "Add 2 people" }).click();

  await expect(page.getByRole("status")).toContainText("Added 2 people");
  expect(await page.evaluate(() => (window as unknown as { __revoked: string[] }).__revoked)).toEqual(["fake-token"]);
  // Only the ticked contacts went to our server (AC-9).
  expect(sentRows.join("")).toContain(grandma);
  expect(sentRows.join("")).not.toContain(stranger);

  await page.getByRole("link", { name: "See them on Home" }).click();
  await expect(page.getByRole("link", { name: grandma, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: chris, exact: true })).toBeVisible();

  // Importing again: they're marked as added and can't be ticked (AC-7).
  await page.goto("/people/import");
  await page.getByRole("button", { name: "Connect Google Contacts" }).click();
  await expect(page.getByRole("checkbox", { name: grandma })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: stranger })).toBeEnabled();

  await deleteLeftovers([grandma, chris, stranger]);
});
