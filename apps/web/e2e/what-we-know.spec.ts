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
  await page.goto(`/people/${personId}/know`);
  await expect(page.getByRole("region", { name: "Wants" }).getByText("a new rotary fly-tying vise")).toBeVisible();
  await expect(page.getByRole("button", { name: "Read it now" })).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  // And with a fact open in place (ALL-127).
  await page.getByRole("button", { name: "a new rotary fly-tying vise", exact: true }).click();
  await expect(page.getByRole("button", { name: "Looks right" })).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
});

test("facts open in place and save as you go: confirmed, turned off and on, edited and deleted", async ({ page }, testInfo) => {
  const { personId, vise } = await seed(`Dad ${testInfo.project.name}`);
  const factRow = async () =>
    (await rest(`profile_facts?id=eq.${vise}&select=value,category,active,confirmed`, { profile: "concierge" }))[0];
  await signIn(page);
  await page.goto(`/people/${personId}/know`);

  const know = page.getByRole("region", { name: "What we know" });
  const wants = page.getByRole("region", { name: "Wants" });
  await expect(wants.getByText("a new rotary fly-tying vise")).toBeVisible();
  await expect(wants.getByText("✨ AI suggestion")).toBeVisible();
  await expect(wants.getByRole("link", { name: /Instagram/ })).toHaveAttribute("href", "https://www.instagram.com/p/x");
  await expect(page.getByRole("region", { name: "Already has" }).getByText("Owala water bottle")).toBeVisible();
  await expect(page.getByText("1 capture hasn't been read.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Read it now" })).toBeVisible();
  await expect(page.getByRole("note")).toHaveText("We read each capture with AI, which costs real money: about 2¢ each.");

  // Tapping a fact opens it in place, with no Save button (ALL-127).
  await wants.getByRole("button", { name: "a new rotary fly-tying vise", exact: true }).click();
  await expect(know.getByRole("textbox", { name: "Fact" })).toHaveValue("a new rotary fly-tying vise");
  await expect(know.getByRole("button", { name: "Save" })).toHaveCount(0);

  // Looks right (AC-10): confirmed as it is, and the ✨ goes.
  await know.getByRole("button", { name: "Looks right" }).click();
  await expect(wants.getByText("From a capture")).toBeVisible();
  await expect(wants.getByText("✨ AI suggestion")).toHaveCount(0);
  await expect(know.getByRole("button", { name: "Looks right" })).toHaveCount(0);
  expect(await factRow()).toMatchObject({ value: "a new rotary fly-tying vise", confirmed: true });

  // Use for gift ideas, off (AC-9, AC-5): saved at once, kept so the AI won't suggest it again.
  await know.getByRole("switch", { name: "Use for gift ideas" }).click();
  await expect(know.getByRole("status")).toHaveText("Saved");
  await expect.poll(async () => (await factRow()).active).toBe(false);
  await know.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("region", { name: "Wants" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Wants" })).toHaveCount(0);
  await expect(page.getByText("Turned off (1)")).toBeVisible();

  // Turn it back on.
  await page.getByText("Turned off (1)").click();
  await page.getByRole("button", { name: "Turn on a new rotary fly-tying vise" }).click();
  await expect(wants.getByText("a new rotary fly-tying vise")).toBeVisible();

  // Kind, then words (AC-9): each saves, and the words' save keeps the new kind.
  await wants.getByRole("button", { name: "a new rotary fly-tying vise", exact: true }).click();
  await know.getByRole("combobox", { name: "Kind" }).selectOption("loved");
  await expect(know.getByRole("status")).toHaveText("Saved");
  await expect.poll(async () => (await factRow()).category).toBe("loved");
  const fact = know.getByRole("textbox", { name: "Fact" });
  await fact.fill("a rotary vise");
  await fact.press("Enter");
  await expect(know.getByRole("status")).toHaveText("Saved");
  await expect.poll(factRow).toMatchObject({ value: "a rotary vise", category: "loved" });
  await page.reload();
  await expect(page.getByRole("region", { name: "Loved" }).getByText("a rotary vise")).toBeVisible();

  // Empty words show an error and save nothing.
  await page.getByRole("region", { name: "Loved" }).getByRole("button", { name: "a rotary vise", exact: true }).click();
  await fact.fill("");
  await fact.press("Enter");
  await expect(know.getByRole("alert")).toHaveText("Type something first.");
  expect((await factRow()).value).toBe("a rotary vise");

  // A refused save keeps the words and says why (AC-9).
  await fact.fill("Owala water bottle");
  await know.getByRole("combobox", { name: "Kind" }).selectOption("owns");
  await expect(know.getByRole("alert")).toHaveText("That's already on their profile (it may be turned off).");
  await expect(fact).toHaveValue("Owala water bottle");

  // Delete (AC-4): the row is really gone, and so is it from what ideas read.
  await know.getByRole("button", { name: "Delete", exact: true }).click();
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
  await page.goto(`/people/${personId}/know`);

  await expect(page.getByText("1 capture hasn't been read.")).toBeVisible();
  await expect(page.getByText("Reading pages with AI costs money, so it's only on for test accounts for now.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Read it now" })).toHaveCount(0);
  await expect(page.getByRole("note")).toHaveCount(0);
});

// ALL-186: the person's page sums up what we know in one row, and its page takes a new fact.
test("adds a fact on the What we know page, which the person's row counts", async ({ page }, testInfo) => {
  const name = `Dad Add ${testInfo.project.name}`;
  const { personId } = await seed(name);
  const added = async () =>
    rest(`profile_facts?person_id=eq.${personId}&source=eq.note&select=category,value,source,confirmed,active,changed_at`, { profile: "concierge" });
  await signIn(page);
  await page.goto(`/people/${personId}`);

  // One row, not the list: 2 facts, and the failed capture still to read.
  await expect(page.getByText("a new rotary fly-tying vise")).toHaveCount(0);
  const row = page.getByRole("link", { name: /^What we know/ });
  await expect(row).toHaveText("What we know2 facts · 1 to read");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}/know$`));
  await expect(page.getByRole("heading", { level: 1, name: "What we know" })).toBeVisible();

  // The starter questions are still open, so they're offered with facts known too.
  await expect(page.getByRole("link", { name: "Answer more questions" })).toHaveAttribute("href", `/people/${personId}/questions`);

  const box = page.getByRole("textbox", { name: "Add something" });
  await box.fill("pottery classes");
  await page.getByRole("combobox", { name: "Kind" }).selectOption("wants");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added", { exact: true })).toBeVisible();
  await expect(box).toHaveValue("");
  const wants = page.getByRole("region", { name: "Wants" });
  await expect(wants.getByText("pottery classes")).toBeVisible();
  await expect(wants.getByText("You told us")).toBeVisible();

  // Saved as the buyer's own active fact, with changed_at set (what wakes a waiting round).
  const [fact] = await added();
  expect(fact).toMatchObject({ category: "wants", value: "pottery classes", source: "note", confirmed: true, active: true });
  expect(fact.changed_at).toBeTruthy();

  // The same again is refused, and the words stay.
  await box.fill("Pottery classes");
  await page.getByRole("combobox", { name: "Kind" }).selectOption("wants");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("That's already on their profile.");
  await expect(box).toHaveValue("Pottery classes");
  expect(await added()).toHaveLength(1);

  await page.getByRole("link", { name }).first().click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}$`));
  await expect(page.getByRole("link", { name: /^What we know/ })).toHaveText("What we know3 facts · 1 to read");
});
