import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { addMother, addSavedGift, saveOneGiftList } from "./seed";
import { signIn, session, type Credentials } from "./sign-in";

// Screenshots for the gallery (ALL-000, see playwright.gallery.config.ts).
// Add a screen by adding a line to SIGNED_OUT or SIGNED_IN.
const GALLERY_DIR = path.resolve(__dirname, "../gallery");

async function shoot(page: Page, name: string) {
  // Not "networkidle": the Turnstile widget keeps Chromium busy on the form pages.
  await page.waitForLoadState("load");
  // Streamed pages show "Loading…" first; shoot what follows it.
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  // Settings (and others) show "Loading…" while data streams in; wait for the real content.
  await page.waitForFunction(
    () => ![...document.querySelectorAll("body *")].some((el) => el.children.length === 0 && /^Loading/.test(el.textContent?.trim() ?? "")),
  );
  // ALL-110 fades controls until hydration; wait for the fade to clear, but never fail the shot.
  try {
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('[aria-disabled="true"]')].some((el) =>
          /aria-disabled:opacity/.test(el.getAttribute("class") ?? ""),
        ),
      undefined,
      { timeout: 5000 },
    );
  } catch {
    // A control that is really disabled keeps the class; shoot anyway.
  }
  const file = path.join(GALLERY_DIR, test.info().project.name, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
}

const SIGNED_OUT: [name: string, url: string][] = [
  ["welcome", "/welcome"],
  ["tour", "/tour"],
  ["tour-list", "/tour/list"],
  ["request-access", "/request-access"],
  ["login", "/auth/login"],
  ["sign-up", "/auth/sign-up"],
  ["forgot-password", "/auth/forgot-password"],
];

// Filled in by beforeAll: a fresh account with one person (with a saved gift) and a one-gift list.
type Seeded = { user: Credentials; personId: string; shareToken: string };
const SIGNED_IN: [name: string, url: (s: Seeded) => string][] = [
  ["home", () => "/"],
  ["my-list", () => "/lists"],
  ["person", (s) => `/people/${s.personId}`],
  ["person-questions", (s) => `/people/${s.personId}/questions`],
  ["add-person", () => "/people/new"],
  ["import-people", () => "/people/import"],
  ["settings", () => "/settings"],
  ["settings-over-budget", () => "/settings/over-budget"],
  ["settings-reminders", () => "/settings/reminders"],
  ["settings-address", () => "/settings/address"],
  ["settings-paying", () => "/settings/paying"],
  ["shared-list", (s) => `/share/${s.shareToken}`],
];

for (const [name, url] of SIGNED_OUT) {
  test(`signed out: ${name}`, async ({ page }) => {
    await page.goto(url);
    await shoot(page, name);
  });
}

test.describe("signed in", () => {
  let seeded: Seeded;
  test.beforeAll(async () => {
    const user = await createFreshUser();
    const personId = await addMother(user, "Mom");
    await addSavedGift(user, personId, "Fly-fishing reel");
    await saveOneGiftList(user);
    seeded = { user, personId, shareToken: await shareToken(user) };
  });

  for (const [name, url] of SIGNED_IN) {
    test(name, async ({ page }) => {
      await signIn(page, seeded.user);
      await page.goto(url(seeded));
      await shoot(page, name);
    });
  }
});

// Emails are read on phones, and their colors don't follow dark mode, so only the light phone.
test("emails", async ({ page }) => {
  test.skip(test.info().project.name !== "phone", "emails are shot on the light phone only");
  const dir = mkdtempSync(path.join(tmpdir(), "giftsaf-gallery-emails-"));
  execSync(`pnpm -s email:html "${dir}"`, { cwd: path.resolve(__dirname, ".."), stdio: "inherit" });
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".html")).sort()) {
    await page.setContent(readFileSync(path.join(dir, file), "utf8"));
    await shoot(page, `email-${file.replace(/\.html$/, "")}`);
  }
});

async function shareToken(user: Credentials): Promise<string> {
  const { url, publishableKey } = localSupabase();
  const { access_token, user: me } = await session(user);
  const res = await fetch(`${url}/rest/v1/lists?select=share_token&owner_id=eq.${me.id}`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${access_token}`, "Accept-Profile": "lists" },
  });
  if (!res.ok) throw new Error(`Couldn't read the share token: ${res.status} ${await res.text()}`);
  const [row] = (await res.json()) as { share_token: string }[];
  if (!row) throw new Error("The seeded list has no share token");
  return row.share_token;
}
