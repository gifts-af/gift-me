import { expect, test } from "@playwright/test";
import { localSupabase } from "./local-supabase";
import { TEST_USER } from "./test-user";
import { signIn } from "./sign-in";

// ALL-81: a person's shipping address on their page, at phone and desktop width
// (every project runs it), against the local Supabase. Each project uses its own
// person so parallel runs don't collide.
const supabase = localSupabase();
const serviceHeaders = {
  apikey: supabase.serviceRoleKey,
  Authorization: `Bearer ${supabase.serviceRoleKey}`,
  "Content-Type": "application/json",
};

type Row = {
  recipient_first_name: string | null;
  recipient_last_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  address_checked_at: string | null;
};

async function signInApi(): Promise<{ token: string; id: string }> {
  const res = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabase.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
  });
  if (!res.ok) throw new Error(`Couldn't sign in: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, id: body.user.id };
}

async function deletePeople(name: string) {
  const { id } = await signInApi();
  const res = await fetch(`${supabase.url}/rest/v1/people?user_id=eq.${id}&name=eq.${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: serviceHeaders,
  });
  if (!res.ok) throw new Error(`Couldn't clear the test person: ${res.status} ${await res.text()}`);
}

async function addPerson(name: string): Promise<string> {
  const { token } = await signInApi();
  const res = await fetch(`${supabase.url}/rest/v1/rpc/add_person`, {
    method: "POST",
    headers: {
      apikey: supabase.publishableKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Profile": "concierge",
    },
    body: JSON.stringify({ p_name: name, p_relationship: "friend", p_kinds: [] }),
  });
  if (!res.ok) throw new Error(`Couldn't add the test person: ${res.status} ${await res.text()}`);
  return (await res.json()) as string;
}

async function stored(personId: string): Promise<Row> {
  const res = await fetch(
    `${supabase.url}/rest/v1/people?select=recipient_first_name,recipient_last_name,address_line1,address_line2,city,state,zip,country,address_checked_at&id=eq.${personId}`,
    { headers: serviceHeaders },
  );
  const rows = (await res.json()) as Row[];
  expect(rows).toHaveLength(1);
  return rows[0];
}

const nameFor = (project: string) => `Rita Address ${project}`;

test.afterEach(async ({}, info) => {
  await deletePeople(nameFor(info.project.name));
});

test("add, fix, change and remove a person's address", async ({ page }, info) => {
  const name = nameFor(info.project.name);
  await deletePeople(name);
  const personId = await addPerson(name);
  await signIn(page);
  await page.goto(`/people/${personId}`);
  const section = page.locator("#address");

  // AC-1: no address is normal; nothing to fill in yet.
  await expect(section.getByRole("heading", { name: "Shipping address" })).toBeVisible();
  await expect(section.getByText("Optional for now. We'll ask before their first gift ships.")).toBeVisible();
  await expect(section.getByRole("textbox")).toHaveCount(0);

  // AC-3, AC-5: the name is pre-filled; a bad address shows plain messages and saves nothing.
  await section.getByRole("button", { name: "Add an address" }).click();
  await expect(section.getByLabel("First name")).toHaveValue("Rita Address");
  await expect(section.getByLabel("Last name")).toHaveValue(info.project.name);
  await section.getByLabel("Street address").fill("12 Oak Lane");
  await section.getByLabel("State").selectOption("FL");
  await section.getByLabel("ZIP code").fill("123");
  await section.getByRole("button", { name: "Save address" }).click();
  await expect(section.getByText("Add a city.")).toBeVisible();
  await expect(section.getByText("Enter a 5-digit ZIP code.")).toBeVisible();
  expect((await stored(personId)).address_line1).toBeNull();

  // AC-2: a complete address saves as a US address, checked now.
  await section.getByLabel("City").fill("Tampa");
  await section.getByLabel("ZIP code").fill("33602");
  await section.getByRole("button", { name: "Save address" }).click();
  await expect(section.getByText("Tampa, FL 33602")).toBeVisible();
  await expect(section.getByText("12 Oak Lane")).toBeVisible();
  const saved = await stored(personId);
  expect(saved).toMatchObject({ address_line1: "12 Oak Lane", city: "Tampa", state: "FL", zip: "33602", country: "US" });
  expect(saved.address_checked_at).not.toBeNull();

  // AC-4: change it.
  await section.getByRole("button", { name: "Change address" }).click();
  await section.getByLabel("City").fill("Orlando");
  await section.getByRole("button", { name: "Save address" }).click();
  await expect(section.getByText("Orlando, FL 33602")).toBeVisible();
  expect((await stored(personId)).city).toBe("Orlando");

  // AC-6: Remove asks first; Cancel keeps it, confirming clears it.
  await section.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("heading", { name: `Remove ${name}'s address?` })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(section.getByText("Orlando, FL 33602")).toBeVisible();
  await section.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Remove address" }).click();
  await expect(section.getByRole("button", { name: "Add an address" })).toBeVisible();
  expect(await stored(personId)).toEqual({
    recipient_first_name: null, recipient_last_name: null, address_line1: null, address_line2: null, city: null,
    state: null, zip: null, country: "US", address_checked_at: null,
  });
});
