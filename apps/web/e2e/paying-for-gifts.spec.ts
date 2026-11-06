import { mkdirSync } from "node:fs";
import path from "node:path";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { FAKE_ZINC_URL } from "./fake-zinc";
import { createFreshUser } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { phoneLayoutProblems } from "./phone-layout";
import { signIn, type Credentials } from "./sign-in";

// ALL-32: Settings > Paying for gifts against the fake Zinc (T62):
// - Behavior, on the iPhone only: the four states in order on one dedicated account, then
//   disconnect, then the disconnect-only line for a connected account that can't buy (S7).
//   Evidence screenshots (the iPhone at 390 px and a desktop browser at 1280 px, light and
//   dark) go to e2e/screenshots/ALL-32/.
// - Layout, tagged @layout so it runs on all three browsers, each with its own fresh account.
test.skip(!!process.env.E2E_BASE_URL, "needs the fake Zinc and local Supabase");

const supabase = localSupabase();
const USER = { email: "e2e-zinc@example.test", password: "e2e-local-only-password" };
const SHOTS = path.resolve(__dirname, "screenshots", "ALL-32");

const serviceHeaders = (profile?: string) => ({
  apikey: supabase.serviceRoleKey,
  Authorization: `Bearer ${supabase.serviceRoleKey}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=representation",
  ...(profile ? { "Content-Profile": profile, "Accept-Profile": profile } : {}),
});

async function rest(pathAndQuery: string, init: RequestInit & { profile?: string } = {}) {
  const res = await fetch(`${supabase.url}/rest/v1/${pathAndQuery}`, { ...init, headers: serviceHeaders(init.profile) });
  if (!res.ok) throw new Error(`${pathAndQuery}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function userIdOf(user: Credentials): Promise<string> {
  const token = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabase.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
  return ((await token.json()) as { user: { id: string } }).user.id;
}

async function ensureUser(): Promise<string> {
  const res = await fetch(`${supabase.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ ...USER, email_confirm: true, user_metadata: { display_name: "Zinc E2E" } }),
  });
  if (!res.ok && res.status !== 422) throw new Error(`Couldn't create ${USER.email}: ${res.status}`);
  return userIdOf(USER);
}

async function setPaid(userId: string, paid: boolean) {
  await rest("accounts?on_conflict=user_id", {
    method: "POST",
    profile: "concierge",
    body: JSON.stringify({ user_id: userId, paid_features: paid }),
  });
}

async function resetZinc(userId: string) {
  await rest("rpc/zinc_drop_attempt", { method: "POST", profile: "concierge", body: JSON.stringify({ p_user_id: userId }) });
  await rest("rpc/zinc_forget", { method: "POST", profile: "concierge", body: JSON.stringify({ p_user_id: userId }) });
}

/** A Zinc key saved for the user, the way finishing the Allow sign-in saves it (the fake Zinc accepts it). */
async function saveFakeKey(userId: string) {
  await rest("rpc/zinc_store_secrets", {
    method: "POST",
    profile: "concierge",
    body: JSON.stringify({
      p_user_id: userId,
      p_api_key: "zn_live_E2E_FAKE_KEY",
      p_webhook_secret: "zn_whsec_E2E_FAKE_SECRET",
      p_webhook_id: crypto.randomUUID(),
      p_zinc_env: "live",
    }),
  });
}

/** Light and dark pictures of the page as it is now. */
async function pictures(page: Page, file: string) {
  await expect(page.getByText("Loading your settings…")).toHaveCount(0);
  await expect(section(page)).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), scheme === "dark");
    await page.waitForTimeout(400); // let the colour transitions finish
    await page.screenshot({ path: path.join(SHOTS, `${file}-${scheme}.png`), fullPage: true });
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}

/**
 * Evidence for one state: the iPhone at 390 px, and the same Settings page in a desktop browser
 * at 1280 px (its own signed-in context), light and dark. Pictures only; how it fits is the
 * @layout test's job.
 */
async function shoot(page: Page, browser: Browser, state: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await pictures(page, `${state}-phone`);
  const desktop = await browser.newContext({
    ...devices["Desktop Safari"],
    viewport: { width: 1280, height: 800 },
    baseURL: test.info().project.use.baseURL,
  });
  try {
    const wide = await desktop.newPage();
    await signIn(wide, USER);
    await wide.goto("/settings");
    await pictures(wide, `${state}-desktop`);
  } finally {
    await desktop.close();
  }
}

const section = (page: Page) => page.getByRole("region", { name: /Paying for gifts|Connect Zinc/ });

test.describe("paying for gifts, in order on one account", () => {
  test.describe.configure({ mode: "serial" });
  let userId: string;

  test.beforeAll(async () => {
    userId = await ensureUser();
    await setPaid(userId, false);
    await resetZinc(userId);
    await rest(`budget_defaults?user_id=eq.${userId}`, { method: "DELETE", profile: "concierge" });
    await rest("budget_defaults?on_conflict=user_id,relationship", {
      method: "POST",
      profile: "concierge",
      body: JSON.stringify({ user_id: userId, relationship: "friend", base_amount_cents: 10000 }),
    });
  });

  test.afterAll(async () => {
    if (userId) await resetZinc(userId);
  });

  test("state 1: without paid features it says why and offers nothing", async ({ page, browser }) => {
    await signIn(page, USER);
    await page.goto("/settings");
    await expect(section(page).getByText("Buying gifts is open to test accounts during the alpha.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Zinc" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Disconnect Zinc" })).toHaveCount(0);
    await shoot(page, browser, "1-not-allowed");
  });

  test("states 2 to 4: connect with Allow, save a phone, then disconnect", async ({ page, browser }) => {
    await setPaid(userId, true);
    await signIn(page, USER);
    await page.goto("/settings");

    // State 2: ready to connect, with the alpha money notice.
    await expect(section(page).getByRole("note")).toHaveText(
      "Alpha: each gift costs its price plus Zinc's $1 order fee, taken from your Zinc balance.",
    );
    // One teal main button on the page (Save): Zinc's buttons are outline buttons (owner, 2026-11-06).
    await expect(page.getByRole("button", { name: "Connect Zinc" })).toHaveClass(/border-input/);
    await expect(page.locator("button.bg-primary")).toHaveCount(1);
    await shoot(page, browser, "2-ready-to-connect");

    // State 3: waiting for Allow. Cancel goes back; connecting again gives a fresh code.
    await page.getByRole("button", { name: "Connect Zinc" }).click();
    await expect(page.getByText("Waiting for you to click Allow…")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Connect Zinc" })).toBeVisible();

    await page.getByRole("button", { name: "Connect Zinc" }).click();
    const code = (await page.getByLabel("Your code").textContent())!.trim();
    expect(code).toMatch(/^E2E\d\d-4M2P$/);
    await expect(page.getByRole("link", { name: "Open Zinc" })).toHaveAttribute("href", `${FAKE_ZINC_URL}/activate?c=${code}`);
    await expect(page.getByText("Waiting for you to click Allow…")).toBeVisible();
    await expect(page.getByText(/^Code expires in \d+ min$/)).toBeVisible();
    await shoot(page, browser, "3-waiting-for-allow");
    // The device code is a secret: it must not be anywhere in the page.
    expect(await page.content()).not.toContain(`device-${code}`);

    // The user clicks Allow at Zinc; the page notices by itself at Zinc's interval.
    await fetch(`${FAKE_ZINC_URL}/__approve?user_code=${code}`, { method: "POST" });

    // State 4: connected, with balance, the guide ($100 biggest budget + $1 fee) and the phone field.
    await expect(page.getByText("$40.00")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Not known yet")).toBeVisible();
    await expect(section(page).getByText("$101", { exact: true })).toBeVisible();
    await expect(section(page).getByText("$100", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Zinc wallet" })).toHaveAttribute("href", `${FAKE_ZINC_URL}/wallet`);
    const registered = (await (await fetch(`${FAKE_ZINC_URL}/__state`)).json()) as { webhook: string | null };
    // Built from the site address (siteUrl), not from this request's host (the app runs on E2E_PORT).
    expect(registered.webhook).toMatch(/^http:\/\/localhost:3000\/api\/zinc\/webhook\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Each top-up costs 2.9% + 30¢.")).toBeVisible();

    await page.getByLabel("Your phone").fill("12");
    await page.getByRole("button", { name: "Save phone" }).click();
    await expect(section(page).getByRole("alert")).toHaveText("Enter a 10-digit phone number.");
    await page.getByLabel("Your phone").fill("555 123 4567");
    await page.getByRole("button", { name: "Save phone" }).click();
    await expect(section(page).getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Your phone")).toHaveValue("(555) 123-4567");
    await shoot(page, browser, "4-connected");

    // Disconnect, behind a confirm; the webhook is cleared at Zinc and the page says to revoke the key.
    await page.getByRole("button", { name: "Disconnect Zinc" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByText("Disconnected. To finish, revoke the key in your Zinc account too.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Zinc" })).toBeVisible();
    const after = (await (await fetch(`${FAKE_ZINC_URL}/__state`)).json()) as { webhookCleared: number };
    expect(after.webhookCleared).toBeGreaterThanOrEqual(1);
  });

  // S7 (owner): a saved Zinc key can always be removed, even when buying is off for the account.
  test("state 5: a connected account without paid features can still disconnect", async ({ page, browser }) => {
    await resetZinc(userId);
    await saveFakeKey(userId);
    await setPaid(userId, false);
    await signIn(page, USER);
    await page.goto("/settings");
    await expect(section(page).getByText("Buying gifts is paused for your account.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Zinc", exact: true })).toHaveCount(0);
    await shoot(page, browser, "5-paused-disconnect");

    await page.getByRole("button", { name: "Disconnect Zinc" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByText("Disconnected. To finish, revoke the key in your Zinc account too.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Disconnect Zinc" })).toHaveCount(0);
  });
});

// How the section fits, on all three browsers: the connected view (the longest) and the
// disconnect-only line. Each run has its own account, so the browsers don't race.
test("the Paying for gifts section fits the screen, connected and disconnect-only", { tag: "@layout" }, async ({ page }) => {
  const user = await createFreshUser();
  const userId = await userIdOf(user);
  await setPaid(userId, true);
  await saveFakeKey(userId);
  await signIn(page, user);
  await page.goto("/settings");
  await expect(page.getByText("$40.00")).toBeVisible({ timeout: 15_000 });
  expect(await phoneLayoutProblems(page)).toEqual([]);

  await setPaid(userId, false);
  await page.reload();
  await expect(section(page).getByText("Buying gifts is paused for your account.")).toBeVisible();
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await resetZinc(userId);
});
