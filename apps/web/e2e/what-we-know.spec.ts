import { expect, test, type Page } from "@playwright/test";
import { localSupabase } from "./local-supabase";
import { TEST_USER } from "./test-user";

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

async function rest(path: string, init: RequestInit & { profile?: string } = {}) {
  const headers: Record<string, string> = { ...service, Prefer: "return=representation" };
  if (init.profile) {
    headers["Accept-Profile"] = init.profile;
    headers["Content-Profile"] = init.profile;
  }
  const res = await fetch(`${supabase.url}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
}

async function testUserId(): Promise<string> {
  const res = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabase.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
  });
  return ((await res.json()) as { user: { id: string } }).user.id;
}

/** A person with one read capture (two AI facts) and one capture that failed. */
async function seed(name: string) {
  const userId = await testUserId();
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

async function signIn(page: Page) {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
}

test("AI suggestions show apart and can be removed for good", async ({ page }, testInfo) => {
  // The projects run at once as the same user, so each gets its own Dad.
  const { personId, vise } = await seed(`Dad ${testInfo.project.name}`);
  await signIn(page);
  await page.goto(`/people/${personId}`);

  const ai = page.getByRole("region", { name: /AI suggestions from your captures/ });
  await expect(ai.getByText("Wants: a new rotary fly-tying vise")).toBeVisible();
  await expect(ai.getByText("Already has: Owala water bottle")).toBeVisible();
  await expect(ai.getByRole("link", { name: /Instagram/ }).first()).toHaveAttribute("href", "https://www.instagram.com/p/x");
  await expect(page.getByText("1 capture hasn't been read.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Read it now" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await ai.getByRole("button", { name: "Remove Wants: a new rotary fly-tying vise" }).click();
  await expect(page.getByText("Wants: a new rotary fly-tying vise")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Already has: Owala water bottle")).toBeVisible();
  await expect(page.getByText("Wants: a new rotary fly-tying vise")).toHaveCount(0);

  const [row] = await rest(`profile_facts?id=eq.${vise}&select=active`, { profile: "concierge" });
  expect(row.active).toBe(false);
});
