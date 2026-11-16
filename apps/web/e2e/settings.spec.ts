import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { phoneLayoutProblems } from "./phone-layout";
import { session, signIn } from "./sign-in";

// ALL-115: the Settings screen. This file starts with the hydration check for ALL-102.
// The browser's zone differs from the server's, so a time zone read from the browser
// during render shows up as a hydration error. The e2e runs a production build, where
// React's messages are minified, hence the error numbers.
test.use({ timezoneId: "America/Los_Angeles" });

const supabase = localSupabase();
const HYDRATION = /Hydration|#418|#423|#425/;

async function saveZone(userId: string, timezone: string) {
  const res = await fetch(`${supabase.url}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      apikey: supabase.serviceRoleKey,
      Authorization: `Bearer ${supabase.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ timezone }),
  });
  if (!res.ok) throw new Error(`Couldn't save a zone: ${res.status} ${await res.text()}`);
}

async function readZone(userId: string): Promise<string | null> {
  const res = await fetch(`${supabase.url}/rest/v1/profiles?id=eq.${userId}&select=timezone`, {
    headers: { apikey: supabase.serviceRoleKey, Authorization: `Bearer ${supabase.serviceRoleKey}` },
  });
  if (!res.ok) throw new Error(`Couldn't read a zone: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as { timezone: string | null }[];
  return rows[0]?.timezone ?? null;
}

// The Settings row for a label (a link row, or the time zone row's picker).
const zoneRow = (page: Page) => page.getByLabel("Time zone");
const zoneValue = (page: Page) => page.locator("span[id$=\"-value\"]");

for (const saved of [true, false]) {
  test(`@layout settings loads without a hydration error ${saved ? "with" : "without"} a saved zone`, async ({ page }) => {
    const user = await createFreshUser();
    if (saved) await saveZone((await session(user)).user.id, "Asia/Calcutta");
    await signIn(page, user);

    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));

    await page.goto("/settings");
    await expect(page.getByLabel("Time zone")).toBeVisible();
    // Hydration finishes after the first paint; give it a moment to report.
    await page.waitForLoadState("networkidle");

    expect(problems.filter((text) => HYDRATION.test(text))).toEqual([]);

    // AC-13: every row is at least 44 px, and the picker covers the whole time zone row.
    expect(await phoneLayoutProblems(page)).toEqual([]);
    const links = page.getByRole("main").locator('a[href^="/settings/"]');
    for (const link of await links.all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const picker = (await zoneRow(page).boundingBox())!;
    const row = (await zoneRow(page).locator("xpath=..").boundingBox())!;
    expect(picker.height).toBeGreaterThanOrEqual(44);
    for (const side of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(picker[side] - row[side])).toBeLessThanOrEqual(1);
    }
  });
}

test.describe("with a location header", () => {
  test("no saved zone shows the zone from the request", async ({ page }) => {
    await signIn(page, await createFreshUser());
    // Only the /settings document request carries the header, not Supabase calls.
    await page.route("**/settings", async (route) => {
      await route.continue({ headers: { ...route.request().headers(), "x-vercel-ip-timezone": "America/Chicago" } });
    });
    await page.goto("/settings");
    await expect(zoneValue(page)).toHaveText("Not set (using America/Chicago)");
  });
});

test("settings lists every group and row", async ({ page }) => {
  await signIn(page, await createFreshUser());
  await page.goto("/settings");
  for (const name of ["You", "Reminders", "Gift ideas", "Paying for gifts"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(zoneRow(page)).toBeVisible();
  await expect(page.getByRole("link", { name: /^Email/ })).toContainText("By email");
  await expect(page.getByRole("link", { name: /Over-budget allowance/ })).toContainText("%");
  await expect(page.getByRole("link", { name: /Zinc/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /save/i })).not.toBeVisible();
});

test("address page redirects when the row is hidden", async ({ page }) => {
  await signIn(page, await createFreshUser());
  await page.goto("/settings/address");
  await page.waitForURL("**/settings");
  await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();
});

test("picking a time zone saves it", async ({ page }) => {
  const user = await createFreshUser();
  await signIn(page, user);
  await page.goto("/settings");
  await zoneRow(page).selectOption("Asia/Tokyo");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.locator("span[id$=\"-value\"]", { hasText: "Asia/Tokyo" })).toBeVisible();
  await page.reload();
  await expect(page.locator("span[id$=\"-value\"]", { hasText: "Asia/Tokyo" })).toBeVisible();
  expect(await readZone((await session(user)).user.id)).toBe("Asia/Tokyo");
});

test("no saved zone shows the fallback and saves nothing until picked", async ({ page }) => {
  const user = await createFreshUser();
  await signIn(page, user);
  await page.goto("/settings");
  await expect(zoneValue(page)).toHaveText(/^Not set/);
  await page.waitForLoadState("networkidle");
  expect(await readZone((await session(user)).user.id)).toBeNull();
});

// The field saves when the page is left, so Back straight after typing must not lose it.
test("over-budget saves when Back is tapped straight away", async ({ page }) => {
  await signIn(page, await createFreshUser());
  await page.goto("/settings/over-budget");
  const field = page.getByRole("textbox", { name: "Over-budget allowance" });
  await field.fill("15");
  await page.getByRole("main").getByRole("link", { name: "Settings" }).click();
  await page.waitForURL("**/settings");
  // Let Settings finish loading, so the next goto isn't interrupting it. This also
  // waits for the hide-time save to land.
  await page.waitForLoadState("networkidle");
  // The row shows it without a reload.
  await expect(page.getByRole("link", { name: /Over-budget allowance/ })).toContainText("15%");
  await page.goto("/settings/over-budget");
  await expect(page.getByRole("textbox", { name: "Over-budget allowance" })).toHaveValue("15");
});

test("coming back shows no stale state", async ({ page }) => {
  await signIn(page, await createFreshUser());
  await page.goto("/settings");
  await page.getByRole("link", { name: /Over-budget allowance/ }).click();
  await page.waitForURL("**/settings/over-budget");
  const field = page.getByRole("textbox", { name: "Over-budget allowance" });
  await field.fill("12");
  await field.press("Enter");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Settings" }).click();
  await page.waitForURL("**/settings");
  await expect(page.getByRole("link", { name: /Over-budget allowance/ })).toContainText("12%");
  await page.getByRole("link", { name: /Over-budget allowance/ }).click();
  await page.waitForURL("**/settings/over-budget");
  await expect(page.getByRole("textbox", { name: "Over-budget allowance" })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).not.toBeVisible();
});
