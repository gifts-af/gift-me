import { expect, test } from "@playwright/test";
import { localSupabase } from "./local-supabase";
import { phoneLayoutProblems } from "./phone-layout";
import { SECOND_USER, TEST_USER } from "./test-user";
import { session, signIn } from "./sign-in";

// ALL-25: a person's page lists the AI's suggestions from captures apart from
// anything else, and Remove takes one away for good. The facts are seeded
// straight into the local Supabase (service role), because the running app's
// AI model can't be stubbed; the reading itself is covered by unit tests.

const supabase = localSupabase();
const service = {
  apikey: supabase.serviceRoleKey,
  Authorization: `Bearer ${supabase.serviceRoleKey}`,
  "Content-Type": "application/json",
};

async function rest(path: string, init: RequestInit & { profile?: string; merge?: boolean } = {}) {
  const headers: Record<string, string> = { ...service, Prefer: `return=representation${init.merge ? ",resolution=merge-duplicates" : ""}` };
  if (init.profile) {
    headers["Accept-Profile"] = init.profile;
    headers["Content-Profile"] = init.profile;
  }
  const res = await fetch(`${supabase.url}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
}

type User = typeof TEST_USER;

const userIdOf = async (user: User) => (await session(user)).user.id;

/** A person with one read capture (two AI facts) and one capture that failed. */
async function seed(name: string, { user = TEST_USER, paidFeatures = true }: { user?: User; paidFeatures?: boolean } = {}) {
  const userId = await userIdOf(user);
  await rest("accounts?on_conflict=user_id", {
    method: "POST",
    profile: "concierge",
    merge: true,
    body: JSON.stringify({ user_id: userId, paid_features: paidFeatures }),
  });
  await rest(`people?user_id=eq.${userId}&name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
  const [person] = await rest("people", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, name, relationship: "father" }),
  });
  const [read, failed] = await rest("captures", {
    method: "POST",
    profile: "concierge",
    body: JSON.stringify([
      { user_id: userId, person_id: person.id, source_url: "https://www.instagram.com/p/x", page_title: "Instagram", status: "extracted" },
      { user_id: userId, person_id: person.id, source_url: "https://example.com", page_title: "A page", status: "failed" },
    ]),
  });
  void failed;
  const facts = await rest("profile_facts", {
    method: "POST",
    profile: "concierge",
    body: JSON.stringify([
      { user_id: userId, person_id: person.id, category: "wants", value: "a new rotary fly-tying vise", source: "capture", source_id: read.id },
      { user_id: userId, person_id: person.id, category: "owns", value: "Owala water bottle", source: "capture", source_id: read.id },
    ]),
  });
  return { personId: person.id as string, vise: facts[0].id as string };
}

// The page's layout on every browser; what the buttons do runs on the iPhone only (ALL-118).
test("a person's facts, with an AI suggestion and an unread capture, fit the screen", { tag: "@layout" }, async ({ page }, testInfo) => {
  // The projects run at once as the same user, so each gets its own Dad.
  const { personId } = await seed(`Dad L ${testInfo.project.name}`);
  await signIn(page);
  await page.goto(`/people/${personId}`);
  await expect(page.getByRole("region", { name: "Wants" }).getByText("a new rotary fly-tying vise")).toBeVisible();
  await expect(page.getByRole("button", { name: "Read it now" })).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
});

test("facts show by category with their source, and can be turned off, turned on and deleted", async ({ page }, testInfo) => {
  const { personId, vise } = await seed(`Dad ${testInfo.project.name}`);
  await signIn(page);
  await page.goto(`/people/${personId}`);

  const wants = page.getByRole("region", { name: "Wants" });
  await expect(wants.getByText("a new rotary fly-tying vise")).toBeVisible();
  await expect(wants.getByText("✨ AI suggestion")).toBeVisible();
  await expect(wants.getByRole("link", { name: /Instagram/ })).toHaveAttribute("href", "https://www.instagram.com/p/x");
  await expect(page.getByRole("region", { name: "Already has" }).getByText("Owala water bottle")).toBeVisible();
  await expect(page.getByText("1 capture hasn't been read.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Read it now" })).toBeVisible();
  await expect(page.getByRole("note")).toHaveText("We read each capture with AI, which costs real money: about 2¢ each.");

  // Turn off (AC-5): gone from the profile, kept so the AI won't suggest it again.
  await wants.getByRole("button", { name: "Edit a new rotary fly-tying vise" }).click();
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("region", { name: "Wants" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Wants" })).toHaveCount(0);
  await expect(page.getByText("Turned off (1)")).toBeVisible();
  const [row] = await rest(`profile_facts?id=eq.${vise}&select=active`, { profile: "concierge" });
  expect(row.active).toBe(false);

  // Turn it back on.
  await page.getByText("Turned off (1)").click();
  await page.getByRole("button", { name: "Turn on a new rotary fly-tying vise" }).click();
  await expect(page.getByRole("region", { name: "Wants" }).getByText("a new rotary fly-tying vise")).toBeVisible();

  // Edit (AC-6): the new words stick, and the buyer has now vouched for it.
  await page.getByRole("button", { name: "Edit a new rotary fly-tying vise" }).click();
  await page.getByLabel("Fact").fill("a rotary vise");
  await page.getByRole("region", { name: "What we know" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("region", { name: "Wants" }).getByText("a rotary vise")).toBeVisible();
  await expect(page.getByRole("region", { name: "Wants" }).getByText("From a capture")).toBeVisible();

  // A duplicate gets a plain message (AC-6).
  await page.getByRole("button", { name: "Edit a rotary vise" }).click();
  await page.getByLabel("Fact").fill("Owala water bottle");
  await page.getByLabel("Kind").selectOption("owns");
  await page.getByRole("region", { name: "What we know" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("That's already on their profile (it may be turned off).")).toBeVisible();

  // Delete (AC-4): the row is really gone, and so is it from what ideas read.
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete for good" }).click();
  // By text, and with the dialog gone: an open dialog hides the page from role queries.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("a rotary vise")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("a rotary vise")).toHaveCount(0);
  const rows = await rest(`profile_facts?id=eq.${vise}&select=id`, { profile: "concierge" });
  expect(rows).toHaveLength(0);
  const active = await rest(`profile_facts?person_id=eq.${personId}&active=is.true&select=value`, { profile: "concierge" });
  expect(active).toEqual([{ value: "Owala water bottle" }]);
});

test("without paid features, the page doesn't offer reading and says why (ALL-94)", async ({ page }, testInfo) => {
  const { personId } = await seed(`Dad ${testInfo.project.name}`, { user: SECOND_USER, paidFeatures: false });
  await signIn(page, SECOND_USER);
  await page.goto(`/people/${personId}`);

  await expect(page.getByText("1 capture hasn't been read.")).toBeVisible();
  await expect(page.getByText("Reading captures costs real money, so for now it's only on for test accounts.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Read it now" })).toHaveCount(0);
  await expect(page.getByRole("note")).toHaveCount(0);
});
