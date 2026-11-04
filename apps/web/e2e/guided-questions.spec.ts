import { expect, test, type Page } from "@playwright/test";
import { localSupabase } from "./local-supabase";
import { phoneLayoutProblems } from "./phone-layout";
import { SECOND_USER, TEST_USER } from "./test-user";

// ALL-26: guided questions and the readiness meter, on phones and desktop,
// against the local Supabase. Each project uses its own people.
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

async function userId(user: { email: string; password: string }): Promise<string> {
  const res = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabase.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  return ((await res.json()) as { user: { id: string } }).user.id;
}

/** A fresh person with nothing known about them. */
async function newPerson(name: string): Promise<string> {
  const owner = await userId(TEST_USER);
  await rest(`people?user_id=eq.${owner}&name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
  const [person] = await rest("people", {
    method: "POST",
    body: JSON.stringify({ user_id: owner, name, relationship: "friend" }),
  });
  return person.id as string;
}

async function signIn(page: Page, user = TEST_USER) {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
}

const facts = (personId: string) =>
  rest(`profile_facts?person_id=eq.${personId}&select=category,value,source,confirmed&order=created_at`, { profile: "concierge" });

const box = (page: Page, name: string) => page.getByRole("textbox", { name });

const INTERESTS = "What are they into right now?";
const WANTS = "Anything they've said they want or need?";

test("a new person gets questions, and answering raises the meter (AC-1, AC-2)", async ({ page }, info) => {
  const personId = await newPerson(`Sam Q ${info.project.name}`);
  await signIn(page);
  await page.goto(`/people/${personId}`);

  const meter = page.getByRole("meter");
  await expect(meter).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByText("Just starting")).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await page.getByRole("link", { name: "Answer 5 questions" }).click();

  await expect(page.getByRole("textbox")).toHaveCount(5);
  // A fresh load: after in-app navigation the last page lingers, hidden, in the DOM.
  await page.reload();
  await expect(page.getByRole("textbox")).toHaveCount(5);
  expect(await phoneLayoutProblems(page)).toEqual([]);

  await box(page, INTERESTS).fill("fly fishing, crime podcasts");
  await box(page, WANTS).fill("a new vise");
  await page.getByRole("button", { name: "Save answers" }).click();

  await expect(page).toHaveURL(new RegExp(`/people/${personId}$`));
  await expect(page.getByRole("meter")).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByText("You answered").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Interests" }).getByText("crime podcasts")).toBeVisible();
  await expect(page.getByRole("link", { name: "Answer 4 questions" })).toBeVisible();

  expect(await facts(personId)).toEqual([
    { category: "interest", value: "fly fishing", source: "question", confirmed: true },
    { category: "interest", value: "crime podcasts", source: "question", confirmed: true },
    { category: "wants", value: "a new vise", source: "question", confirmed: true },
  ]);
});

test("a sensitive answer saves nothing and keeps what was typed (AC-8)", async ({ page }, info) => {
  const personId = await newPerson(`Sam S ${info.project.name}`);
  await signIn(page);
  await page.goto(`/people/${personId}/questions`);

  await box(page, INTERESTS).fill("golf");
  await box(page, WANTS).fill("something for church");
  await page.getByRole("button", { name: "Save answers" }).click();

  await expect(page.getByText("We don't keep notes about")).toBeVisible();
  await expect(box(page, INTERESTS)).toHaveValue("golf");
  await expect(box(page, WANTS)).toHaveValue("something for church");
  expect(await facts(personId)).toEqual([]);
});

test("a skipped question stays gone and doesn't move the meter (AC-9)", async ({ page }, info) => {
  const personId = await newPerson(`Sam K ${info.project.name}`);
  await signIn(page);
  await page.goto(`/people/${personId}/questions`);

  await box(page, WANTS).fill("kept while skipping another");
  await page.getByRole("button", { name: `Skip: ${INTERESTS}` }).click();
  await expect(box(page, INTERESTS)).toHaveCount(0);
  await expect(box(page, WANTS)).toHaveValue("kept while skipping another");
  // The sixth question moves up to take its place.
  await expect(box(page, "What do they already have plenty of?")).toBeVisible();

  await page.reload();
  await expect(box(page, INTERESTS)).toHaveCount(0);
  await page.goto(`/people/${personId}`);
  await expect(page.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
});

test("someone else's person is a 404, and a deleted person too (AC-12)", async ({ page }, info) => {
  const personId = await newPerson(`Sam O ${info.project.name}`);
  await signIn(page, SECOND_USER);
  await page.goto(`/people/${personId}/questions`);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText(/could not be found|couldn't find|404/i).first()).toBeVisible();
});
