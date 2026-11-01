import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { localSupabase } from "./local-supabase";
import { SECOND_USER, TEST_USER } from "./test-user";

// ALL-23: a one-time email action link, end to end against the local Supabase.
// Each test stores its own fresh link (action "test", an hour to live, for
// TEST_USER) the way the app does: only the SHA-256 of the token is kept.
const supabase = localSupabase();
const serviceHeaders = {
  apikey: supabase.serviceRoleKey,
  Authorization: `Bearer ${supabase.serviceRoleKey}`,
  "Content-Type": "application/json",
  "Accept-Profile": "concierge",
  "Content-Profile": "concierge",
};

async function userId(user: { email: string; password: string }): Promise<string> {
  const res = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabase.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (!res.ok) throw new Error(`Couldn't look up ${user.email}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

async function makeLink(): Promise<{ token: string; tokenHash: string }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const res = await fetch(`${supabase.url}/rest/v1/action_links`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({
      user_id: await userId(TEST_USER),
      action: "test",
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`Couldn't store the link: ${res.status} ${await res.text()}`);
  return { token, tokenHash };
}

async function usedAt(tokenHash: string): Promise<string | null> {
  const res = await fetch(`${supabase.url}/rest/v1/action_links?select=used_at&token_hash=eq.${tokenHash}`, {
    headers: serviceHeaders,
  });
  const rows = (await res.json()) as { used_at: string | null }[];
  expect(rows).toHaveLength(1);
  return rows[0].used_at;
}

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
}

test("signed out, an action link asks you to sign in and isn't used up", async ({ page }) => {
  const { token, tokenHash } = await makeLink();
  await page.goto(`/a/${token}`);
  await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
  expect(await usedAt(tokenHash)).toBeNull();
});

test("the owner opens it (twice, nothing happens), confirms, then it's used", async ({ page }) => {
  const { token, tokenHash } = await makeLink();
  await signIn(page, TEST_USER);

  // AC-3: opening the link only reads.
  for (let i = 0; i < 2; i++) {
    await page.goto(`/a/${token}`);
    await expect(page.getByRole("heading", { name: "Try the test button" })).toBeVisible();
  }
  expect(await usedAt(tokenHash)).toBeNull();

  // AC-4: the button does the action and uses the link up.
  await page.getByRole("button", { name: "Try it", exact: true }).click();
  await expect(page.getByText("It works. Buttons in our emails will look like this.")).toBeVisible();
  expect(await usedAt(tokenHash)).not.toBeNull();

  // AC-5: once used, it stays used.
  await page.reload();
  await expect(page.getByRole("heading", { name: "This link has already been used" })).toBeVisible();
});

test("another account sees it's for someone else, without the action", async ({ page }) => {
  const { token, tokenHash } = await makeLink();
  await signIn(page, SECOND_USER);
  await page.goto(`/a/${token}`);
  await expect(page.getByRole("heading", { name: "This link is for a different account" })).toBeVisible();
  await expect(page.getByText("Try the test button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try it", exact: true })).toHaveCount(0);
  expect(await usedAt(tokenHash)).toBeNull();
});
